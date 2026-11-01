package com.komikta.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "reading_history")
data class ReadingHistoryEntity(
    @PrimaryKey val id: String, // source_slug
    val source: String,
    val comicSlug: String,
    val comicTitle: String,
    val coverUrl: String?,
    val lastChapterSlug: String?,
    val lastChapterNumber: String?,
    val lastReadAt: Long,
    val progressPage: Int = 0
)

@Entity(tableName = "read_chapters", primaryKeys = ["comicId", "chapterSlug"])
data class ReadChapterEntity(
    val comicId: String,
    val chapterSlug: String,
    val readAt: Long
)

@Entity(tableName = "bookmarks")
data class BookmarkEntity(
    @PrimaryKey val id: String, // source_slug
    val source: String,
    val comicSlug: String,
    val comicTitle: String,
    val coverUrl: String?,
    val type: String?,
    val status: String?,
    val bookmarkedAt: Long
)
