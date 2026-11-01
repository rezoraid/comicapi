package com.komikta.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class ApiResponse<T>(
    val ok: Boolean,
    val data: T? = null,
    val error: ApiErrorDto? = null
)

@Serializable
data class ApiErrorDto(
    val code: String? = null,
    val message: String? = null
)

@Serializable
data class SourcesResponse(
    val items: List<SourceDto> = emptyList()
)

@Serializable
data class SourceDto(
    val id: String,
    val name: String,
    val base: String? = null,
    val filters: SourceFiltersDto? = null,
    val features: List<String> = emptyList()
)

@Serializable
data class SourceFiltersDto(
    val types: List<String> = emptyList(),
    val statuses: List<String> = emptyList(),
    val sorts: List<String> = emptyList()
)

@Serializable
data class ComicListResponse(
    val page: Int? = null,
    val items: List<ComicListItemDto> = emptyList()
)

@Serializable
data class ComicListItemDto(
    val title: String = "",
    val slug: String = "",
    val url: String? = null,
    val cover: String? = null,
    val type: String? = null,
    val status: String? = null,
    val rating: Double? = null,
    val chapterCount: Int? = null,
    val chapters: List<ChapterSummaryDto> = emptyList(),
    val genres: List<String> = emptyList(),
    // Opsional: dipakai kalau API mengirimnya di list. JsonElement supaya angka/teks sama-sama aman.
    val author: String? = null,
    val views: JsonElement? = null
)

@Serializable
data class ChapterSummaryDto(
    val slug: String = "",
    val number: String? = null,
    val title: String? = null,
    val timeAgo: String? = null
)

@Serializable
data class ComicDetailDto(
    val title: String = "",
    val slug: String = "",
    val url: String? = null,
    val cover: String? = null,
    val alt: List<String> = emptyList(),
    val synopsis: String? = null,
    val status: String? = null,
    val type: String? = null,
    val author: String? = null,
    val artist: String? = null,
    val year: String? = null,
    val views: Double? = null,          // API kadang kirim 13.3
    val rating: Double? = null,
    val ratingCount: Double? = null,
    val genres: List<String> = emptyList(),
    val totalChapters: Int? = null,
    val chapters: List<ChapterSummaryDto> = emptyList()
)

@Serializable
data class ChapterContentDto(
    val title: String? = null,
    val comic: String? = null,
    val chapter: String? = null,
    val url: String? = null,
    val images: List<String> = emptyList(),
    val proxy: List<String> = emptyList(),
    val prev: String? = null,
    val next: String? = null
)

@Serializable
data class GenresResponse(
    val items: List<String> = emptyList()
)
