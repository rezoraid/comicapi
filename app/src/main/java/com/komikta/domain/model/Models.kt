package com.komikta.domain.model

data class Source(
    val id: String,
    val name: String,
    val features: List<String> = emptyList(),
    val types: List<String> = emptyList(),
    val statuses: List<String> = emptyList(),
    val sorts: List<String> = emptyList()
)

data class Comic(
    val title: String,
    val slug: String,
    val coverUrl: String? = null,
    val type: String? = null,
    val status: String? = null,
    val rating: Double? = null,
    val chapterCount: Int? = null,
    val genres: List<String> = emptyList(),
    val source: String,
    val author: String? = null,
    val views: Double? = null,
    val chapters: List<Chapter> = emptyList()
)

data class ComicDetail(
    val title: String,
    val slug: String,
    val coverUrl: String? = null,
    val alternativeTitles: List<String> = emptyList(),
    val synopsis: String? = null,
    val status: String? = null,
    val type: String? = null,
    val author: String? = null,
    val artist: String? = null,
    val year: String? = null,
    val views: Double? = null,
    val rating: Double? = null,
    val genres: List<String> = emptyList(),
    val totalChapters: Int? = null,
    val chapters: List<Chapter> = emptyList(),
    val source: String
)

data class Chapter(
    val slug: String,
    val number: String? = null,
    val title: String? = null,
    val timeAgo: String? = null
)

data class ChapterContent(
    val title: String? = null,
    val comicSlug: String,
    val chapterSlug: String,
    val imageUrls: List<String> = emptyList(),
    val proxyPaths: List<String> = emptyList(),
    val prevChapterSlug: String? = null,
    val nextChapterSlug: String? = null,
    val source: String
)

data class BrowseParams(
    val source: String,
    val page: Int = 1,
    val type: String? = null,
    val status: String? = null,
    val sort: String? = null,
    val genres: String? = null
)

data class SearchParams(
    val source: String,
    val query: String,
    val page: Int = 1
)
