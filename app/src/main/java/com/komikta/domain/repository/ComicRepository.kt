package com.komikta.domain.repository

import com.komikta.core.common.Result
import com.komikta.domain.model.BrowseParams
import com.komikta.domain.model.ChapterContent
import com.komikta.domain.model.Comic
import com.komikta.domain.model.ComicDetail
import com.komikta.domain.model.SearchParams
import com.komikta.domain.model.Source
import kotlinx.coroutines.flow.Flow

interface ComicRepository {
    suspend fun getSources(): Result<List<Source>>
    suspend fun getLatest(source: String, page: Int = 1): Result<List<Comic>>
    suspend fun getPopular(source: String): Result<List<Comic>>
    suspend fun browse(params: BrowseParams): Result<List<Comic>>
    suspend fun search(params: SearchParams): Result<List<Comic>>
    suspend fun getGenres(source: String): Result<List<String>>
    suspend fun getComicDetail(source: String, slug: String): Result<ComicDetail>
    suspend fun getChapterContent(
        source: String,
        comicSlug: String,
        chapterSlug: String
    ): Result<ChapterContent>
}
