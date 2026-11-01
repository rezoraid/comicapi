package com.komikta.di

import android.content.Context
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.komikta.data.local.dao.ReadChapterDao
import com.komikta.core.database.KomiktaDatabase
import com.komikta.data.local.dao.BookmarkDao
import com.komikta.data.local.dao.ReadingHistoryDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    private val MIGRATION_1_2 = object : Migration(1, 2) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS `read_chapters` (" +
                    "`comicId` TEXT NOT NULL, `chapterSlug` TEXT NOT NULL, `readAt` INTEGER NOT NULL, " +
                    "PRIMARY KEY(`comicId`, `chapterSlug`))"
            )
        }
    }

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): KomiktaDatabase {
        return Room.databaseBuilder(
            context,
            KomiktaDatabase::class.java,
            "komikta.db"
        )
            .addMigrations(MIGRATION_1_2)
            .fallbackToDestructiveMigration()
            .build()
    }

    @Provides
    fun provideReadingHistoryDao(db: KomiktaDatabase): ReadingHistoryDao = db.readingHistoryDao()

    @Provides
    fun provideReadChapterDao(db: KomiktaDatabase): ReadChapterDao = db.readChapterDao()

    @Provides
    fun provideBookmarkDao(db: KomiktaDatabase): BookmarkDao = db.bookmarkDao()
}
