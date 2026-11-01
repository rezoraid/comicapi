package com.komikta.data.repository

import com.komikta.core.common.Result
import com.komikta.data.remote.api.KomiktaApi
import com.komikta.data.remote.dto.toDomain
import com.komikta.domain.model.BrowseParams
import com.komikta.domain.model.ChapterContent
import com.komikta.domain.model.Comic
import com.komikta.domain.model.ComicDetail
import com.komikta.domain.model.SearchParams
import com.komikta.domain.model.Source
import com.komikta.domain.repository.ComicRepository
import com.komikta.core.network.HttpException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ComicRepositoryImpl @Inject constructor(
    private val api: KomiktaApi
) : ComicRepository {

    private data class CacheEntry<T>(val value: T, val storedAt: Long = System.currentTimeMillis())
    private val listCache = ConcurrentHashMap<String, CacheEntry<Result<List<Comic>>>>()
    private val detailCache = ConcurrentHashMap<String, CacheEntry<Result<ComicDetail>>>()
    private val chapterCache = ConcurrentHashMap<String, CacheEntry<Result<ChapterContent>>>()

    private fun <T> cached(cache: ConcurrentHashMap<String, CacheEntry<T>>, key: String, ttlMs: Long): T? {
        val entry = cache[key] ?: return null
        if (System.currentTimeMillis() - entry.storedAt > ttlMs) {
            cache.remove(key, entry)
            return null
        }
        return entry.value
    }

    private fun <T> trimCache(cache: ConcurrentHashMap<String, CacheEntry<T>>, maxEntries: Int) {
        if (cache.size > maxEntries) {
            cache.entries.sortedBy { it.value.storedAt }
                .take(cache.size - maxEntries)
                .forEach { cache.remove(it.key, it.value) }
        }
    }

    override suspend fun getSources(): Result<List<Source>> = safeApiCall {
        val response = api.getSources()
        if (!response.ok || response.data == null) {
            return@safeApiCall Result.Error(
                message = response.error?.message ?: "Failed to fetch sources",
                code = response.error?.code
            )
        }
        val items = response.data.items.map { it.toDomain() }
        if (items.isEmpty()) Result.Empty else Result.Success(items)
    }

    override suspend fun getLatest(source: String, page: Int): Result<List<Comic>> =
        cachedList("latest:$source:$page") {
            val response = api.getLatest(source, page)
            mapListResponse(response, source)
        }

    override suspend fun getPopular(source: String): Result<List<Comic>> =
        cachedList("popular:$source") {
            val response = api.getPopular(source)
            mapListResponse(response, source)
        }

    override suspend fun browse(params: BrowseParams): Result<List<Comic>> =
        cachedList("browse:${params.source}:${params.page}:${params.type}:${params.status}:${params.sort}:${params.genres}") {
            val response = api.browse(
                source = params.source,
                page = params.page,
                type = params.type,
                status = params.status,
                sort = params.sort,
                genres = params.genres
            )
            mapListResponse(response, params.source)
        }

    override suspend fun search(params: SearchParams): Result<List<Comic>> =
        cachedList("search:${params.source}:${params.query.trim().lowercase()}:${params.page}") {
            val response = api.search(params.source, params.query, params.page)
            mapListResponse(response, params.source)
        }

    private suspend fun cachedList(
        key: String,
        request: suspend () -> Result<List<Comic>>
    ): Result<List<Comic>> {
        cached(listCache, key, 60_000L)?.let { return it }
        val result = safeApiCall { request() }
        if (result is Result.Success || result is Result.Empty) {
            listCache[key] = CacheEntry(result)
            trimCache(listCache, 100)
        }
        return result
    }

    override suspend fun getGenres(source: String): Result<List<String>> = safeApiCall {
        val response = api.getGenres(source)
        if (!response.ok || response.data == null) {
            return@safeApiCall Result.Error(
                message = response.error?.message ?: "Failed to fetch genres",
                code = response.error?.code
            )
        }
        val items = response.data.items
        if (items.isEmpty()) Result.Empty else Result.Success(items)
    }

    override suspend fun getComicDetail(source: String, slug: String): Result<ComicDetail> {
        val key = "$source:$slug"
        cached(detailCache, key, 300_000L)?.let { return it }
        val result = safeApiCall {
            val response = api.getComicDetail(source, slug)
            if (!response.ok || response.data == null) {
                return@safeApiCall Result.Error(
                    message = response.error?.message ?: "Comic not found",
                    code = response.error?.code
                )
            }
            Result.Success(response.data.toDomain(source))
        }
        if (result is Result.Success) {
            detailCache[key] = CacheEntry(result)
            trimCache(detailCache, 100)
        }
        return result
    }

    override suspend fun getChapterContent(
        source: String,
        comicSlug: String,
        chapterSlug: String
    ): Result<ChapterContent> {
        val key = "$source:$comicSlug:$chapterSlug"
        cached(chapterCache, key, 600_000L)?.let { return it }
        val result = safeApiCall {
            val response = api.getChapterContent(source, comicSlug, chapterSlug)
            if (!response.ok || response.data == null) {
                return@safeApiCall Result.Error(
                    message = response.error?.message ?: "Chapter not found",
                    code = response.error?.code
                )
            }
            Result.Success(response.data.toDomain(source, comicSlug, chapterSlug))
        }
        if (result is Result.Success) {
            chapterCache[key] = CacheEntry(result)
            trimCache(chapterCache, 40)
        }
        return result
    }

    private fun mapListResponse(
        response: com.komikta.data.remote.dto.ApiResponse<com.komikta.data.remote.dto.ComicListResponse>,
        source: String
    ): Result<List<Comic>> {
        if (!response.ok || response.data == null) {
            return Result.Error(
                message = response.error?.message ?: "Failed to fetch comics",
                code = response.error?.code
            )
        }
        val items = response.data.items.map { it.toDomain(source) }
        return if (items.isEmpty()) Result.Empty else Result.Success(items)
    }

    private suspend fun <T> safeApiCall(block: suspend () -> Result<T>): Result<T> {
        return try {
            withContext(Dispatchers.Default) { block() }
        } catch (e: CancellationException) {
            throw e
        } catch (e: SocketTimeoutException) {
            Result.Error(message = "Request timeout. Please try again.", throwable = e)
        } catch (e: UnknownHostException) {
            Result.Error(message = "No internet connection.", throwable = e)
        } catch (e: HttpException) {
            if (e.code >= 500) {
                Result.Error(message = "Server error. Please try again later.", code = e.code.toString(), throwable = e)
            } else {
                Result.Error(message = "Request failed (${e.code})", code = e.code.toString(), throwable = e)
            }
        } catch (e: IOException) {
            Result.Error(message = "Network error. Please check your connection.", throwable = e)
        } catch (e: Exception) {
            Result.Error(message = e.message ?: "Unexpected error occurred", throwable = e)
        }
    }
}
