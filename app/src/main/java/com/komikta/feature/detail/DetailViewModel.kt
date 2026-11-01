package com.komikta.feature.detail

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.komikta.core.common.Result
import com.komikta.data.local.ReaderPrefs
import com.komikta.data.local.dao.BookmarkDao
import com.komikta.data.local.dao.ReadChapterDao
import com.komikta.data.local.entity.BookmarkEntity
import com.komikta.data.repository.CommunityRepository
import com.komikta.domain.model.ComicDetail
import com.komikta.domain.usecase.GetComicDetailUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DetailUiState(
    val isLoading: Boolean = true,
    val detail: ComicDetail? = null,
    val errorMessage: String? = null,
    val chaptersNewestFirst: Boolean = true
)

@HiltViewModel
class DetailViewModel @Inject constructor(
    private val getComicDetail: GetComicDetailUseCase,
    private val bookmarkDao: BookmarkDao,
    readChapterDao: ReadChapterDao,
    private val prefs: ReaderPrefs,
    private val community: CommunityRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val source: String = savedStateHandle["source"] ?: "lumos"
    private val slug: String = savedStateHandle["slug"] ?: ""
    private val bookmarkId = "${source}_$slug"

    private val _uiState = MutableStateFlow(DetailUiState(chaptersNewestFirst = prefs.chaptersNewestFirst.value))
    val uiState: StateFlow<DetailUiState> = _uiState.asStateFlow()

    private val _chapterComments = MutableStateFlow<Map<String, Int>>(emptyMap())
    val chapterComments: StateFlow<Map<String, Int>> = _chapterComments.asStateFlow()

    fun loadChapterComments() {
        if (slug.isBlank()) return
        viewModelScope.launch {
            val r = community.chapterCounts(source, slug)
            if (r is Result.Success) _chapterComments.value = r.data
        }
    }

    val isBookmarked: StateFlow<Boolean> = bookmarkDao.isBookmarked(bookmarkId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    val readChapters: StateFlow<Set<String>> = readChapterDao.observeRead(bookmarkId)
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptySet())

    init { loadDetail() }

    fun loadDetail() {
        if (slug.isBlank()) {
            _uiState.update { it.copy(isLoading = false, errorMessage = "Invalid comic") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            when (val result = getComicDetail(source, slug)) {
                is Result.Success -> _uiState.update { it.copy(isLoading = false, detail = result.data) }
                is Result.Error -> _uiState.update { it.copy(isLoading = false, errorMessage = result.message) }
                else -> _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun toggleBookmark() {
        viewModelScope.launch {
            val detail = _uiState.value.detail ?: return@launch
            val existing = bookmarkDao.getById(bookmarkId)
            if (existing != null) {
                bookmarkDao.delete(bookmarkId)
            } else {
                bookmarkDao.upsert(
                    BookmarkEntity(
                        id = bookmarkId,
                        source = source,
                        comicSlug = slug,
                        comicTitle = detail.title,
                        coverUrl = detail.coverUrl,
                        type = detail.type,
                        status = detail.status,
                        bookmarkedAt = System.currentTimeMillis()
                    )
                )
            }
        }
    }

    fun toggleChapterOrder() {
        val newValue = !_uiState.value.chaptersNewestFirst
        prefs.setChaptersNewestFirst(newValue)
        _uiState.update { it.copy(chaptersNewestFirst = newValue) }
    }
}
