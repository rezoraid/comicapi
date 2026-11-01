package com.komikta.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.komikta.data.local.entity.BookmarkEntity
import com.komikta.data.local.entity.ReadChapterEntity
import com.komikta.data.local.entity.ReadingHistoryEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ReadingHistoryDao {
    @Query("SELECT * FROM reading_history ORDER BY lastReadAt DESC LIMIT :limit")
    fun getRecentHistory(limit: Int = 50): Flow<List<ReadingHistoryEntity>>

    @Query("SELECT * FROM reading_history WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): ReadingHistoryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: ReadingHistoryEntity)

    @Query("DELETE FROM reading_history WHERE id = :id")
    suspend fun delete(id: String)

    @Query("DELETE FROM reading_history")
    suspend fun clearAll()
}

@Dao
interface BookmarkDao {
    @Query("SELECT * FROM bookmarks ORDER BY bookmarkedAt DESC")
    fun getAll(): Flow<List<BookmarkEntity>>

    @Query("SELECT * FROM bookmarks WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): BookmarkEntity?

    @Query("SELECT EXISTS(SELECT 1 FROM bookmarks WHERE id = :id)")
    fun isBookmarked(id: String): Flow<Boolean>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: BookmarkEntity)

    @Query("DELETE FROM bookmarks WHERE id = :id")
    suspend fun delete(id: String)
}

@Dao
interface ReadChapterDao {
    @Query("SELECT chapterSlug FROM read_chapters WHERE comicId = :comicId")
    fun observeRead(comicId: String): Flow<List<String>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun markRead(entity: ReadChapterEntity)
}
