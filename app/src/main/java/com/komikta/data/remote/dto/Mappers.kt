package com.komikta.data.remote.dto

import com.komikta.domain.model.Chapter
import com.komikta.domain.model.ChapterContent
import com.komikta.domain.model.Comic
import com.komikta.domain.model.ComicDetail
import com.komikta.domain.model.Source
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

fun SourceDto.toDomain(): Source = Source(
    id = id,
    name = name,
    features = features,
    types = filters?.types.orEmpty(),
    statuses = filters?.statuses.orEmpty(),
    sorts = filters?.sorts.orEmpty()
)

fun ComicListItemDto.toDomain(source: String): Comic = Comic(
    title = title,
    slug = slug,
    coverUrl = cover,
    type = type,
    status = status,
    rating = rating,
    chapterCount = chapterCount,
    genres = genres,
    source = source,
    author = author?.trim()?.takeIf { it.isNotEmpty() },
    views = views.toViewCount(),
    chapters = chapters.map { it.toDomain() }
)

private val GroupedNumber = Regex("""^\d{1,3}([.,]\d{3})+$""")

/** Terima angka (18664676 / 13.3) atau teks ("18.664.676"); selain itu dianggap tidak ada. */
private fun JsonElement?.toViewCount(): Double? {
    val p = this as? JsonPrimitive ?: return null
    p.doubleOrNull?.let { return it.takeIf { v -> v > 0 } }
    val t = p.content.trim()
    val v = when {
        GroupedNumber.matches(t) -> t.replace(".", "").replace(",", "").toDoubleOrNull()
        else -> t.replace(',', '.').toDoubleOrNull()
    }
    return v?.takeIf { it > 0 }
}

fun ChapterSummaryDto.toDomain(): Chapter = Chapter(
    slug = slug,
    number = number,
    title = title,
    timeAgo = timeAgo
)

fun ComicDetailDto.toDomain(source: String): ComicDetail = ComicDetail(
    title = title,
    slug = slug,
    coverUrl = cover,
    alternativeTitles = alt,
    synopsis = synopsis,
    status = status,
    type = type,
    author = author,
    artist = artist,
    year = year,
    views = views,
    rating = rating,
    genres = genres,
    totalChapters = totalChapters,
    chapters = chapters.map { it.toDomain() },
    source = source
)

fun ChapterContentDto.toDomain(source: String, comicSlug: String, chapterSlug: String): ChapterContent {
    // Prefer proxy paths when present (often faster / fewer hotlink blocks)
    val urls = when {
        proxy.isNotEmpty() -> proxy.map { path ->
            if (path.startsWith("http")) path
            else com.komikta.core.network.ApiConfig.BASE_URL.trimEnd('/') + "/" + path.trimStart('/')
        }
        else -> images
    }
    return ChapterContent(
        title = title,
        comicSlug = comicSlug,
        chapterSlug = chapterSlug,
        imageUrls = urls,
        proxyPaths = proxy,
        prevChapterSlug = prev,
        nextChapterSlug = next,
        source = source
    )
}
