package com.komikta.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class CommunityUserDto(
    val id: String = "",
    val username: String = "",
    val name: String = "",
    val picture: String = "",
    val role: String = "USER",
    val publicHistory: Boolean = false,
    val level: Int = 1,
    val email: String? = null,
    val xp: Int = 0,
    val xpCurrentLevel: Int = 0,
    val xpNextLevel: Int = 0,
    val usernameChangeableAt: Long = 0L,
    val commentCount: Int = -1,
    val joinedAt: Long = 0L
)

@Serializable
data class AuthResponse(val token: String, val user: CommunityUserDto)

@Serializable
data class MeResponse(val user: CommunityUserDto, val token: String? = null)

@Serializable
data class CommentDto(
    val id: String,
    val parentId: String? = null,
    val replyTo: String? = null,
    val body: String = "",
    val deleted: Boolean = false,
    val edited: Boolean = false,
    val createdAt: Long = 0L,
    val likeCount: Int = 0,
    val replyCount: Int = 0,
    val liked: Boolean = false,
    val canEdit: Boolean = false,
    val canDelete: Boolean = false,
    val user: CommunityUserDto = CommunityUserDto()
)

@Serializable
data class CommentPageDto(
    val items: List<CommentDto> = emptyList(),
    val hasMore: Boolean = false,
    val page: Int = 1,
    val total: Int = 0
)

@Serializable
data class CommentResultDto(
    val comment: CommentDto,
    val xpGained: Int = 0,
    val xpReason: String? = null,
    val user: CommunityUserDto? = null
)

@Serializable
data class CommentEditDto(val comment: CommentDto)

@Serializable
data class ChapterCountsDto(val counts: Map<String, Int> = emptyMap())

@Serializable
data class LikeResultDto(val liked: Boolean = false, val likeCount: Int = 0)

@Serializable
data class OkDto(val ok: Boolean = true)

@Serializable
data class ReportedCommentDto(
    val id: String = "",
    val body: String = "",
    val deleted: Boolean = false,
    val targetKey: String = "",
    val reportCount: Int = 0,
    val user: CommunityUserDto? = null
)

@Serializable
data class ReportDto(
    val id: String,
    val reason: String = "",
    val note: String = "",
    val status: String = "open",
    val createdAt: Long = 0L,
    val reporter: CommunityUserDto? = null,
    val comment: ReportedCommentDto? = null
)

@Serializable
data class ReportPageDto(
    val items: List<ReportDto> = emptyList(),
    val hasMore: Boolean = false,
    val page: Int = 1
)

@Serializable
data class ResolveDto(val ok: Boolean = true, val status: String = "")

@Serializable
data class PublicReadingHistoryDto(
    val user: CommunityUserDto = CommunityUserDto(),
    val items: List<PublicReadingProgressDto> = emptyList()
)

@Serializable
data class PublicReadingProgressDto(
    val source: String = "",
    val slug: String = "",
    val chapter: String = "",
    val comicTitle: String = "",
    val chapterTitle: String = "",
    val coverUrl: String = "",
    val updatedAt: Long = 0L
)
