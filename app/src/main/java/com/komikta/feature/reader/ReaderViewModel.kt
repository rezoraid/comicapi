package com.komikta.feature.reader

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.komikta.core.common.Result
import com.komikta.data.local.ReaderPrefs
import com.komikta.data.local.dao.ReadChapterDao
import com.komikta.data.local.dao.ReadingHistoryDao
import com.komikta.data.local.entity.ReadChapterEntity
import com.komikta.data.local.entity.ReadingHistoryEntity
import com.komikta.data.remote.dto.CommentPageDto
import com.komikta.data.repository.CommunityRepository
import com.komikta.domain.model.Chapter
import com.komikta.domain.model.ChapterContent
import com.komikta.domain.usecase.GetChapterContentUseCase
import com.komikta.domain.usecase.GetComicDetailUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ReaderUiState(
    val isLoading: Boolean = true,
    val content: ChapterContent? = null,
    val loaded: List<ChapterContent> = emptyList(),
    val upcoming: ChapterContent? = null,
    val chapterInfo: Map<String, Chapter> = emptyMap(),
    val errorMessage: String? = null,
    val source: String = "",
    val comicSlug: String = ""
)

@HiltViewModel
class ReaderViewModel @Inject constructor(
    private val getChapterContent: GetChapterContentUseCase,
    private val getComicDetail: GetComicDetailUseCase,
    private val prefs: ReaderPrefs,
    private val historyDao: ReadingHistoryDao,
    private val readChapterDao: ReadChapterDao,
    private val community: CommunityRepository,
    private val savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val source: String = savedStateHandle["source"] ?: "lumos"
    private val comicSlug: String = savedStateHandle["comicSlug"] ?: ""
    private var chapterSlug: String = savedStateHandle["chapterSlug"] ?: ""
    private var prefetchJob: Job? = null
    private var appending = false
    private var comicTitle: String? = null
    private var comicCover: String? = null

    private val _uiState = MutableStateFlow(ReaderUiState(source = source, comicSlug = comicSlug))
    val uiState: StateFlow<ReaderUiState> = _uiState.asStateFlow()

    val autoNext: StateFlow<Boolean> = prefs.autoNext

    val readSlugs: StateFlow<Set<String>> = readChapterDao.observeRead("${source}_$comicSlug")
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptySet())

    fun setAutoNext(value: Boolean) = prefs.setAutoNext(value)

    private val commentCache = HashMap<String, Pair<Long, CommentPageDto>>()

    suspend fun commentPreview(chapter: String): CommentPageDto? {
        val hit = commentCache[chapter]
        if (hit != null && System.currentTimeMillis() - hit.first < 20_000) return hit.second
        return when (val r = community.comments(source, comicSlug, chapter, "top", 1)) {
            is Result.Success -> r.data.also { commentCache[chapter] = System.currentTimeMillis() to it }
            else -> null
        }
    }

    init {
        loadChapter()
        loadChapterInfo()
    }

    fun loadChapter(newChapterSlug: String? = null) {
        if (newChapterSlug != null) chapterSlug = newChapterSlug
        if (comicSlug.isBlank() || chapterSlug.isBlank()) {
            _uiState.update { it.copy(isLoading = false, errorMessage = "Invalid chapter") }
            return
        }
        val ready = _uiState.value.upcoming?.takeIf { it.chapterSlug == chapterSlug }
        if (ready != null) { open(ready); return }
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            when (val result = getChapterContent(source, comicSlug, chapterSlug)) {
                is Result.Success -> open(result.data)
                is Result.Error -> _uiState.update { it.copy(isLoading = false, errorMessage = result.message) }
                else -> _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    private fun open(content: ChapterContent) {
        chapterSlug = content.chapterSlug
        _uiState.update {
            it.copy(isLoading = false, errorMessage = null, content = content, loaded = listOf(content), upcoming = null)
        }
        viewModelScope.launch { saveHistory(content) }
        prefetchNext(content)
    }

    private fun prefetchNext(from: ChapterContent) {
        prefetchJob?.cancel()
        val next = from.nextChapterSlug?.takeIf { it.isNotBlank() } ?: return
        prefetchJob = viewModelScope.launch {
            val data = getChapterContent(source, comicSlug, next).getOrNull() ?: return@launch
            _uiState.update { st -> if (st.loaded.lastOrNull()?.chapterSlug == from.chapterSlug) st.copy(upcoming = data) else st }
        }
    }

    fun appendNext() {
        if (appending) return
        val st = _uiState.value
        val last = st.loaded.lastOrNull() ?: return
        val next = last.nextChapterSlug?.takeIf { it.isNotBlank() } ?: return
        if (st.loaded.any { it.chapterSlug == next }) return
        appending = true
        viewModelScope.launch {
            val data = st.upcoming?.takeIf { it.chapterSlug == next } ?: getChapterContent(source, comicSlug, next).getOrNull()
            appending = false
            if (data == null) return@launch
            _uiState.update { s -> if (s.loaded.lastOrNull()?.chapterSlug == last.chapterSlug) s.copy(loaded = s.loaded + data, upcoming = null) else s }
            prefetchNext(data)
        }
    }

    fun setCurrent(slug: String) {
        val st = _uiState.value
        if (st.content?.chapterSlug == slug) return
        val target = st.loaded.firstOrNull { it.chapterSlug == slug } ?: return
        chapterSlug = slug
        _uiState.update { it.copy(content = target) }
        viewModelScope.launch { saveHistory(target) }
    }

    private fun loadChapterInfo() {
        if (comicSlug.isBlank()) return
        viewModelScope.launch {
            val detail = getComicDetail(source, comicSlug).getOrNull() ?: return@launch
            comicTitle = detail.title.takeIf { it.isNotBlank() }
            comicCover = detail.coverUrl
            _uiState.update { it.copy(chapterInfo = detail.chapters.associateBy { c -> c.slug }) }
            _uiState.value.content?.let { saveHistory(it) }
        }
    }

    private suspend fun saveHistory(content: ChapterContent) {
        val id = "${source}_$comicSlug"
        val old = historyDao.getById(id)
        val number = _uiState.value.chapterInfo[content.chapterSlug]?.number
        readChapterDao.markRead(ReadChapterEntity(comicId = id, chapterSlug = content.chapterSlug, readAt = System.currentTimeMillis()))
        historyDao.upsert(
            ReadingHistoryEntity(
                id = id,
                source = source,
                comicSlug = comicSlug,
                comicTitle = comicTitle ?: old?.comicTitle ?: content.title ?: comicSlug,
                coverUrl = comicCover ?: old?.coverUrl,
                lastChapterSlug = content.chapterSlug,
                lastChapterNumber = number ?: content.title,
                lastReadAt = System.currentTimeMillis()
            )
        )
        if (community.user.value != null) {
            community.saveReadingProgress(
                source = source,
                slug = comicSlug,
                chapter = content.chapterSlug,
                comicTitle = comicTitle ?: content.title ?: comicSlug,
                chapterTitle = content.title ?: content.chapterSlug,
                coverUrl = comicCover.orEmpty()
            )
        }
    }

    fun goPrev() {
        _uiState.value.content?.prevChapterSlug?.let { loadChapter(it) }
    }

    fun goNext() {
        _uiState.value.content?.nextChapterSlug?.let { loadChapter(it) }
    }
}
