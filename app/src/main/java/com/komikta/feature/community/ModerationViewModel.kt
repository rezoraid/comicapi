package com.komikta.feature.community

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.komikta.core.common.Result
import com.komikta.data.remote.dto.ReportDto
import com.komikta.data.repository.CommunityRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ModerationUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val items: List<ReportDto> = emptyList(),
    val page: Int = 0,
    val hasMore: Boolean = false,
    val loadingMore: Boolean = false,
    val notice: String? = null
)

@HiltViewModel
class ModerationViewModel @Inject constructor(private val repo: CommunityRepository) : ViewModel() {
    private val _ui = MutableStateFlow(ModerationUiState())
    val ui: StateFlow<ModerationUiState> = _ui.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _ui.update { it.copy(loading = true, error = null) }
            when (val r = repo.reports(1)) {
                is Result.Success -> _ui.update { it.copy(loading = false, items = r.data.items, page = 1, hasMore = r.data.hasMore) }
                is Result.Error -> _ui.update { it.copy(loading = false, error = r.message) }
                else -> _ui.update { it.copy(loading = false) }
            }
        }
    }

    fun loadMore() {
        val s = _ui.value
        if (s.loading || s.loadingMore || !s.hasMore) return
        viewModelScope.launch {
            _ui.update { it.copy(loadingMore = true) }
            when (val r = repo.reports(s.page + 1)) {
                is Result.Success -> _ui.update { st ->
                    val known = st.items.map { it.id }.toSet()
                    st.copy(loadingMore = false, items = st.items + r.data.items.filter { it.id !in known }, page = s.page + 1, hasMore = r.data.hasMore)
                }
                is Result.Error -> _ui.update { it.copy(loadingMore = false, notice = r.message) }
                else -> _ui.update { it.copy(loadingMore = false) }
            }
        }
    }

    fun resolve(report: ReportDto, action: String) {
        viewModelScope.launch {
            when (val r = repo.resolveReport(report.id, action)) {
                is Result.Success -> _ui.update { st ->
                    val cid = report.comment?.id
                    st.copy(items = st.items.filter { it.id != report.id && (cid == null || it.comment?.id != cid) }, notice = if (action == "delete") "Komentar dihapus" else "Laporan diabaikan")
                }
                is Result.Error -> _ui.update { it.copy(notice = r.message) }
                else -> Unit
            }
        }
    }

    fun clearNotice() = _ui.update { it.copy(notice = null) }
}
