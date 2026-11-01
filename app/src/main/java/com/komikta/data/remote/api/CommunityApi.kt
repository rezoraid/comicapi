package com.komikta.data.remote.api

import com.komikta.BuildConfig
import com.komikta.core.network.ApiConfig
import com.komikta.core.network.HttpException
import com.komikta.data.local.SessionStore
import com.komikta.data.remote.dto.ApiResponse
import com.komikta.data.remote.dto.AuthResponse
import com.komikta.data.remote.dto.ChapterCountsDto
import com.komikta.data.remote.dto.CommentEditDto
import com.komikta.data.remote.dto.CommentPageDto
import com.komikta.data.remote.dto.CommentResultDto
import com.komikta.data.remote.dto.LikeResultDto
import com.komikta.data.remote.dto.MeResponse
import com.komikta.data.remote.dto.OkDto
import com.komikta.data.remote.dto.ReportPageDto
import com.komikta.data.remote.dto.PublicReadingHistoryDto
import com.komikta.data.remote.dto.ResolveDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

@Singleton
class CommunityApi @Inject constructor(
    client: OkHttpClient,
    private val json: Json,
    private val session: SessionStore
) {
    private val http = client.newBuilder().callTimeout(ApiConfig.REQUEST_TIMEOUT_MS, TimeUnit.MILLISECONDS).build()
    private val base = ApiConfig.BASE_URL.toHttpUrl()
    private val userAgent = "Komikta-Android/${BuildConfig.VERSION_NAME}"
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    suspend fun loginGoogle(idToken: String): ApiResponse<AuthResponse> =
        call("POST", listOf("auth", "google"), body = buildJsonObject { put("idToken", idToken) })

    suspend fun me(): ApiResponse<MeResponse> = call("GET", listOf("me"))

    suspend fun updateUsername(username: String): ApiResponse<MeResponse> =
        call("PATCH", listOf("me"), body = buildJsonObject { put("username", username) })

    suspend fun updateAvatar(imageData: String): ApiResponse<MeResponse> =
        call("PUT", listOf("me", "avatar"), body = buildJsonObject { put("image", imageData) })

    suspend fun deleteAccount(): ApiResponse<OkDto> = call("DELETE", listOf("me"))

    suspend fun setReadingHistoryPublic(isPublic: Boolean): ApiResponse<OkDto> =
        call("PUT", listOf("me", "history-visibility"), body = buildJsonObject { put("publicHistory", isPublic) })

    suspend fun saveReadingProgress(source: String, slug: String, chapter: String, comicTitle: String, chapterTitle: String, coverUrl: String): ApiResponse<OkDto> =
        call("PUT", listOf("me", "reading-progress"), body = buildJsonObject {
            put("source", source); put("slug", slug); put("chapter", chapter)
            put("comicTitle", comicTitle); put("chapterTitle", chapterTitle); put("coverUrl", coverUrl)
        })

    suspend fun publicReadingHistory(userId: String): ApiResponse<PublicReadingHistoryDto> =
        call("GET", listOf("users", userId, "history"))

    suspend fun reports(page: Int): ApiResponse<ReportPageDto> =
        call("GET", listOf("admin", "reports"), query = mapOf("page" to page.toString()))

    suspend fun resolveReport(id: String, action: String): ApiResponse<ResolveDto> =
        call("POST", listOf("admin", "reports", id, "resolve"), body = buildJsonObject { put("action", action) })

    suspend fun comments(source: String, slug: String, chapter: String?, sort: String, page: Int): ApiResponse<CommentPageDto> =
        call(
            "GET", listOf("comments"),
            query = buildMap<String, String> {
                put("type", if (chapter == null) "comic" else "chapter")
                put("source", source)
                put("slug", slug)
                if (chapter != null) put("chapter", chapter)
                put("sort", sort)
                put("page", page.toString())
            }
        )

    suspend fun counts(source: String, slug: String): ApiResponse<ChapterCountsDto> =
        call("GET", listOf("comments", "counts"), query = mapOf("source" to source, "slug" to slug))

    suspend fun replies(rootId: String, page: Int): ApiResponse<CommentPageDto> =
        call("GET", listOf("comments", rootId, "replies"), query = mapOf("page" to page.toString()))

    suspend fun post(source: String, slug: String, chapter: String?, parentId: String?, text: String): ApiResponse<CommentResultDto> =
        call(
            "POST", listOf("comments"),
            body = buildJsonObject {
                if (parentId != null) put("parentId", parentId)
                else {
                    put("type", if (chapter == null) "comic" else "chapter")
                    put("source", source)
                    put("slug", slug)
                    if (chapter != null) put("chapter", chapter)
                }
                put("body", text)
            }
        )

    suspend fun edit(id: String, text: String): ApiResponse<CommentEditDto> =
        call("PATCH", listOf("comments", id), body = buildJsonObject { put("body", text) })

    suspend fun delete(id: String): ApiResponse<OkDto> = call("DELETE", listOf("comments", id))

    suspend fun like(id: String, on: Boolean): ApiResponse<LikeResultDto> =
        call(if (on) "PUT" else "DELETE", listOf("comments", id, "like"))

    suspend fun report(id: String, reason: String, note: String): ApiResponse<OkDto> =
        call("POST", listOf("comments", id, "report"), body = buildJsonObject { put("reason", reason); put("note", note) })

    private fun url(segments: List<String>, query: Map<String, String>): HttpUrl =
        base.newBuilder().apply {
            addPathSegment("api")
            addPathSegment("community")
            segments.forEach { addPathSegment(it) }
            query.forEach { (k, v) -> addQueryParameter(k, v) }
        }.build()

    private suspend inline fun <reified T> call(
        method: String,
        segments: List<String>,
        query: Map<String, String> = emptyMap(),
        body: JsonObject? = null
    ): ApiResponse<T> {
        val (code, text) = execute(method, url(segments, query), body)
        return withContext(Dispatchers.Default) {
            try {
                json.decodeFromString(ApiResponse.serializer(serializer<T>()), text)
            } catch (e: SerializationException) {
                if (code in 200..299) throw e else throw HttpException(code)
            }
        }
    }

    private suspend fun execute(method: String, url: HttpUrl, body: JsonObject?): Pair<Int, String> = suspendCancellableCoroutine { cont ->
        val payload = when {
            body != null -> body.toString().toRequestBody(jsonType)
            method == "POST" || method == "PUT" || method == "PATCH" -> "{}".toRequestBody(jsonType)
            else -> null
        }
        val builder = Request.Builder().url(url).header("Accept", "application/json").header("User-Agent", userAgent)
        session.token?.let { builder.header("Authorization", "Bearer $it") }
        val call = http.newCall(builder.method(method, payload).build())
        cont.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (!call.isCanceled()) cont.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                val code = response.code
                try {
                    cont.resume(code to response.use { it.body?.string().orEmpty() })
                } catch (e: IOException) {
                    cont.resumeWithException(e)
                }
            }
        })
    }
}
