package com.komikta.domain.usecase

import com.komikta.core.common.Result
import com.komikta.domain.model.BrowseParams
import com.komikta.domain.model.ChapterContent
import com.komikta.domain.model.Comic
import com.komikta.domain.model.ComicDetail
import com.komikta.domain.model.SearchParams
import com.komikta.domain.model.Source
import com.komikta.domain.repository.ComicRepository
import javax.inject.Inject

class GetSourcesUseCase @Inject constructor(
    private val repository: ComicRepository
) {
    suspend operator fun invoke(): Result<List<Source>> = repository.getSources()
}

class GetLatestComicsUseCase @Inject constructor(
    private val repository: ComicRepository
) {
    suspend operator fun invoke(source: String, page: Int = 1): Result<List<Comic>> =
        repository.getLatest(source, page)
}

class GetPopularComicsUseCase @Inject constructor(
    private val repository: ComicRepository
) {
    suspend operator fun invoke(source: String): Result<List<Comic>> =
        repository.getPopular(source)
}

class BrowseComicsUseCase @Inject constructor(
    private val repository: ComicRepository
) {
    suspend operator fun invoke(params: BrowseParams): Result<List<Comic>> =
        repository.browse(params)
}

class SearchComicsUseCase @Inject constructor(
    private val repository: ComicRepository
) {
    suspend operator fun invoke(params: SearchParams): Result<List<Comic>> =
        repository.search(params)
}

class GetGenresUseCase @Inject constructor(
    private val repository: ComicRepository
) {
    suspend operator fun invoke(source: String): Result<List<String>> =
        repository.getGenres(source)
}

class GetComicDetailUseCase @Inject constructor(
    private val repository: ComicRepository
) {
    suspend operator fun invoke(source: String, slug: String): Result<ComicDetail> =
        repository.getComicDetail(source, slug)
}

class GetChapterContentUseCase @Inject constructor(
    private val repository: ComicRepository
) {
    suspend operator fun invoke(
        source: String,
        comicSlug: String,
        chapterSlug: String
    ): Result<ChapterContent> = repository.getChapterContent(source, comicSlug, chapterSlug)
}
