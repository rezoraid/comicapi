package com.komikta.data.remote.api

import com.komikta.BuildConfig
import com.komikta.core.network.ApiConfig
import com.komikta.core.network.HttpException
import com.komikta.data.remote.dto.ApiResponse
import com.komikta.data.remote.dto.ChapterContentDto
import com.komikta.data.remote.dto.ComicDetailDto
import com.komikta.data.remote.dto.ComicListResponse
import com.komikta.data.remote.dto.GenresResponse
import com.komikta.data.remote.dto.SourcesResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

@Singleton
class KomiktaApi @Inject constructor(
    client: OkHttpClient,
    private val json: Json
) {
    private val http = client.newBuilder()
        .callTimeout(ApiConfig.REQUEST_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .build()
    private val base = ApiConfig.BASE_URL.toHttpUrl()
    private val userAgent = "Komikta-Android/${BuildConfig.VERSION_NAME}"

    suspend fun getSources(): ApiResponse<SourcesResponse> =
        get(url("api", "sources"))

    suspend fun getLatest(source: String, page: Int = 1): ApiResponse<ComicListResponse> =
        get(url("api", source, "latest") { addQueryParameter("page", page.toString()) })

    suspend fun getPopular(source: String): ApiResponse<ComicListResponse> =
        get(url("api", source, "popular"))

    suspend fun browse(
        source: String,
        page: Int = 1,
        type: String? = null,
        status: String? = null,
        sort: String? = null,
        genres: String? = null
    ): ApiResponse<ComicListResponse> = get(
        url("api", source, "browse") {
            addQueryParameter("page", page.toString())
            type?.let { addQueryParameter("type", it) }
            status?.let { addQueryParameter("status", it) }
            sort?.let { addQueryParameter("sort", it) }
            genres?.let { addQueryParameter("genre", it) }
        }
    )

    suspend fun search(source: String, query: String, page: Int = 1): ApiResponse<ComicListResponse> =
        get(
            url("api", source, "search") {
                addQueryParameter("q", query)
                addQueryParameter("page", page.toString())
            }
        )

    suspend fun getGenres(source: String): ApiResponse<GenresResponse> =
        get(url("api", source, "genres"))

    suspend fun getComicDetail(source: String, slug: String): ApiResponse<ComicDetailDto> =
        get(url("api", source, "comic", slug))

    suspend fun getChapterContent(
        source: String,
        comicSlug: String,
        chapterSlug: String
    ): ApiResponse<ChapterContentDto> =
        get(url("api", source, "chapter", comicSlug, chapterSlug))

    private fun url(vararg segments: String, params: HttpUrl.Builder.() -> Unit = {}): HttpUrl =
        base.newBuilder().apply {
            segments.forEach { addPathSegment(it) }
            params()
        }.build()

    private suspend inline fun <reified T> get(url: HttpUrl): ApiResponse<T> {
        val (code, text) = execute(url)
        return withContext(Dispatchers.Default) {
            try {
                json.decodeFromString(ApiResponse.serializer(serializer<T>()), text)
            } catch (e: SerializationException) {
                if (code in 200..299) throw e else throw HttpException(code)
            }
        }
    }

    private suspend fun execute(url: HttpUrl): Pair<Int, String> = suspendCancellableCoroutine { cont ->
        val call = http.newCall(
            Request.Builder()
                .url(url)
                .header("Accept", "application/json")
                .header("User-Agent", userAgent)
                .build()
        )
        cont.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (!call.isCanceled()) cont.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                val code = response.code
                try {
                    val text = response.use { it.body?.string().orEmpty() }
                    cont.resume(code to text)
                } catch (e: IOException) {
                    cont.resumeWithException(e)
                }
            }
        })
    }
}
