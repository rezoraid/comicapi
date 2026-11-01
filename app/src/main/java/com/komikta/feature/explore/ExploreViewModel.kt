package com.komikta.feature.explore

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.komikta.core.common.Result
import com.komikta.core.network.ApiConfig
import com.komikta.domain.model.BrowseParams
import com.komikta.domain.model.Comic
import com.komikta.domain.model.SearchParams
import com.komikta.domain.usecase.BrowseComicsUseCase
import com.komikta.domain.usecase.GetGenresUseCase
import com.komikta.domain.usecase.SearchComicsUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ExploreUiState(
    val query: String = "",
    val isLoading: Boolean = false,
    val isLoadingMore: Boolean = false,
    val comics: List<Comic> = emptyList(),
    val page: Int = 1,
    val canLoadMore: Boolean = true,
    val errorMessage: String? = null,
    val genres: List<String> = emptyList(),
    val selectedGenres: Set<String> = emptySet(),
    val type: String? = null,
    val sort: String? = null,
    val status: String? = null
)

private fun String.titleCase(): String =
    trim().split(" ").joinToString(" ") { w -> w.replaceFirstChar { it.uppercase() } }

private val CURATED_GENRES = listOf(
    "Action", "Adaptation", "Adult", "Adventure", "Comedy", "Cooking", "Crime", "Drama",
    "Ecchi", "Fantasy", "Harem", "Historical", "Horror", "Isekai", "Martial Arts", "Mature",
    "Mystery", "Psychological", "Reincarnation", "Revenge", "Romance", "School Life", "Sci-Fi",
    "Seinen", "Shoujo", "Shounen", "Slice of Life", "Sports", "Supernatural", "Thriller", "Tragedy"
)

@HiltViewModel
class ExploreViewModel @Inject constructor(
    private val searchComics: SearchComicsUseCase,
    private val browseComics: BrowseComicsUseCase,
    private val getGenres: GetGenresUseCase
) : ViewModel() {

    private val _uiState = MutableStateFlow(ExploreUiState())
    val uiState: StateFlow<ExploreUiState> = _uiState.asStateFlow()

    private var searchJob: Job? = null

    init {
        loadGenres()
        loadInitial()
    }

    private fun loadGenres() {
        viewModelScope.launch {
            val result = getGenres(ApiConfig.DEFAULT_SOURCE)
            val remote = (result as? Result.Success)?.data.orEmpty()
            val keys = remote.map { it.trim().lowercase() }.toSet()
            val curated = if (remote.isEmpty() || CURATED_GENRES.any { it.lowercase() in keys }) {
                CURATED_GENRES
            } else {
                remote.take(30).map { it.titleCase() }
            }
            _uiState.update { it.copy(genres = curated) }
        }
    }

    fun onQueryChange(query: String) {
        _uiState.update { it.copy(query = query) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(350)
            if (query.isBlank()) loadInitial() else doSearch(query)
        }
    }

    private data class PageBatch(val items: List<Comic>, val canLoadMore: Boolean, val error: String?)

    private suspend fun fetchPage(page: Int, state: ExploreUiState): PageBatch {
        val result = browseComics(
            BrowseParams(
                source = ApiConfig.DEFAULT_SOURCE,
                page = page,
                type = state.type,
                status = state.status,
                sort = state.sort,
                genres = state.selectedGenres.takeIf { it.isNotEmpty() }?.joinToString(",") { it.lowercase() }
            )
        )
        val data = (result as? Result.Success)?.data.orEmpty()
        return PageBatch(data.distinctBy { it.slug }, data.isNotEmpty(), (result as? Result.Error)?.message)
    }

    private fun filtersChanged(old: ExploreUiState, new: ExploreUiState) =
        old.selectedGenres != new.selectedGenres || old.type != new.type ||
            old.sort != new.sort || old.status != new.status

    fun applyFilters(genres: Set<String>, sort: String?, status: String?) {
        val old = _uiState.value
        val new = old.copy(selectedGenres = genres, sort = sort, status = status, query = "")
        _uiState.value = new
        if (filtersChanged(old, new)) loadInitial()
    }

    fun setType(type: String?) {
        val old = _uiState.value
        if (old.type == type) return
        _uiState.value = old.copy(type = type, query = "")
        loadInitial()
    }

    private fun loadInitial() {
        viewModelScope.launch {
            val snapshot = _uiState.value
            _uiState.update { it.copy(isLoading = true, errorMessage = null, page = 1, canLoadMore = true, comics = emptyList()) }
            val batch = fetchPage(1, snapshot)
            if (filtersChanged(snapshot, _uiState.value)) return@launch
            _uiState.update {
                it.copy(
                    isLoading = false,
                    comics = batch.items,
                    page = 1,
                    canLoadMore = batch.canLoadMore,
                    errorMessage = if (batch.items.isEmpty()) (batch.error ?: "Tidak ada komik untuk filter ini") else null
                )
            }
        }
    }

    fun loadMore() {
        val state = _uiState.value
        if (state.isLoading || state.isLoadingMore || !state.canLoadMore || state.query.isNotBlank()) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingMore = true) }
            val next = state.page + 1
            val batch = fetchPage(next, state)
            if (filtersChanged(state, _uiState.value)) return@launch
            _uiState.update {
                val merged = (it.comics + batch.items).distinctBy { c -> c.slug }
                it.copy(
                    isLoadingMore = false,
                    comics = merged,
                    page = next,
                    canLoadMore = batch.canLoadMore && merged.size > it.comics.size,
                    errorMessage = if (merged.isEmpty()) batch.error else null
                )
            }
        }
    }

    private fun doSearch(query: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null, canLoadMore = false) }
            val source = ApiConfig.DEFAULT_SOURCE
            val result = searchComics(SearchParams(source = source, query = query, page = 1))
            val all = (result as? Result.Success)?.data.orEmpty().distinctBy { it.slug }
            val error = (result as? Result.Error)?.message
            _uiState.update {
                it.copy(
                    isLoading = false,
                    comics = all,
                    errorMessage = if (all.isEmpty()) error else null
                )
            }
        }
    }
}
