package com.komikta.feature.community

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.komikta.core.common.Result
import com.komikta.data.remote.dto.CommentDto
import com.komikta.data.repository.CommunityRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class RepliesState(
    val items: List<CommentDto> = emptyList(),
    val page: Int = 0,
    val hasMore: Boolean = true,
    val loading: Boolean = false,
    val expanded: Boolean = false
)

data class CommentsUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val items: List<CommentDto> = emptyList(),
    val total: Int = 0,
    val page: Int = 0,
    val hasMore: Boolean = false,
    val loadingMore: Boolean = false,
    val sort: String = "newest",
    val replies: Map<String, RepliesState> = emptyMap(),
    val sending: Boolean = false,
    val notice: String? = null,
    val replyingTo: CommentDto? = null,
    val editing: CommentDto? = null
)

@HiltViewModel
class CommentsViewModel @Inject constructor(
    private val repo: CommunityRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    val source: String = savedStateHandle["source"] ?: ""
    val slug: String = savedStateHandle["slug"] ?: ""
    val chapter: String? = savedStateHandle["chapter"]
    val chapterLabel: String? = chapter?.let { c -> Regex("""\d+(?:[.-]\d+)?""").find(c)?.value?.replace('-', '.') ?: c }

    val user = repo.user
    private val _ui = MutableStateFlow(CommentsUiState())
    val ui: StateFlow<CommentsUiState> = _ui.asStateFlow()
    private val _draft = MutableStateFlow("")
    val draft: StateFlow<String> = _draft.asStateFlow()

    init { load() }

    fun setDraft(v: String) { if (v.length <= MAX_LEN) _draft.value = v }

    fun notice(msg: String?) = _ui.update { it.copy(notice = msg) }

    fun load() {
        viewModelScope.launch {
            _ui.update { it.copy(loading = true, error = null) }
            when (val r = repo.comments(source, slug, chapter, _ui.value.sort, 1)) {
                is Result.Success -> _ui.update { it.copy(loading = false, items = r.data.items, total = r.data.total, page = 1, hasMore = r.data.hasMore, replies = emptyMap()) }
                is Result.Error -> _ui.update { it.copy(loading = false, error = r.message) }
                else -> _ui.update { it.copy(loading = false) }
            }
        }
    }

    fun setSort(sort: String) {
        if (sort == _ui.value.sort) return
        _ui.update { it.copy(sort = sort, items = emptyList()) }
        load()
    }

    fun loadMore() {
        val s = _ui.value
        if (s.loading || s.loadingMore || !s.hasMore) return
        viewModelScope.launch {
            _ui.update { it.copy(loadingMore = true) }
            when (val r = repo.comments(source, slug, chapter, s.sort, s.page + 1)) {
                is Result.Success -> _ui.update { st ->
                    val known = st.items.map { it.id }.toSet()
                    st.copy(loadingMore = false, items = st.items + r.data.items.filter { it.id !in known }, page = s.page + 1, hasMore = r.data.hasMore, total = r.data.total)
                }
                is Result.Error -> _ui.update { it.copy(loadingMore = false, notice = r.message) }
                else -> _ui.update { it.copy(loadingMore = false) }
            }
        }
    }

    fun toggleReplies(root: CommentDto) {
        val cur = _ui.value.replies[root.id] ?: RepliesState()
        _ui.update { it.copy(replies = it.replies + (root.id to cur.copy(expanded = !cur.expanded))) }
        if (!cur.expanded && cur.page == 0) loadReplies(root.id)
    }

    fun loadReplies(rootId: String) {
        val cur = _ui.value.replies[rootId] ?: RepliesState()
        if (cur.loading || !cur.hasMore) return
        viewModelScope.launch {
            _ui.update { it.copy(replies = it.replies + (rootId to cur.copy(loading = true))) }
            when (val r = repo.replies(rootId, cur.page + 1)) {
                is Result.Success -> _ui.update { st ->
                    val prev = st.replies[rootId] ?: cur
                    val known = prev.items.map { it.id }.toSet()
                    st.copy(replies = st.replies + (rootId to prev.copy(items = prev.items + r.data.items.filter { it.id !in known }, page = cur.page + 1, hasMore = r.data.hasMore, loading = false)))
                }
                is Result.Error -> _ui.update { st -> st.copy(notice = r.message, replies = st.replies + (rootId to (st.replies[rootId] ?: cur).copy(loading = false))) }
                else -> Unit
            }
        }
    }

    fun startReply(c: CommentDto) {
        if (c.id.startsWith(TMP)) return
        val wasEditing = _ui.value.editing != null
        _ui.update { it.copy(replyingTo = c, editing = null) }
        if (wasEditing) _draft.value = ""
    }

    fun startEdit(c: CommentDto) {
        _ui.update { it.copy(editing = c, replyingTo = null) }
        _draft.value = c.body
    }

    fun cancelCompose() {
        val wasEditing = _ui.value.editing != null
        _ui.update { it.copy(editing = null, replyingTo = null) }
        if (wasEditing) _draft.value = ""
    }

    private fun mapAll(id: String, f: (CommentDto) -> CommentDto) = _ui.update { st ->
        st.copy(
            items = st.items.map { if (it.id == id) f(it) else it },
            replies = st.replies.mapValues { (_, rs) -> rs.copy(items = rs.items.map { if (it.id == id) f(it) else it }) }
        )
    }

    private fun addLocal(st: CommentsUiState, c: CommentDto, notice: String? = st.notice): CommentsUiState {
        val rootId = c.parentId
        if (rootId == null) return st.copy(replyingTo = null, items = listOf(c) + st.items, total = st.total + 1, notice = notice)
        val cur = st.replies[rootId] ?: RepliesState()
        return st.copy(
            replyingTo = null,
            total = st.total + 1,
            notice = notice,
            items = st.items.map { if (it.id == rootId) it.copy(replyCount = it.replyCount + 1) else it },
            replies = st.replies + (rootId to cur.copy(expanded = true, items = cur.items + c))
        )
    }

    private fun dropLocal(id: String, rootId: String?) = _ui.update { st ->
        val cur = rootId?.let { st.replies[it] }
        st.copy(
            total = (st.total - 1).coerceAtLeast(0),
            items = st.items.mapNotNull { if (it.id == id) null else if (it.id == rootId) it.copy(replyCount = (it.replyCount - 1).coerceAtLeast(0)) else it },
            replies = if (rootId == null || cur == null) st.replies else st.replies + (rootId to cur.copy(items = cur.items.filter { it.id != id }))
        )
    }

    fun submit() {
        val text = _draft.value.trim()
        val s = _ui.value
        if (text.isEmpty()) return
        val editing = s.editing
        if (editing != null) {
            if (editing.id.startsWith(TMP)) return
            mapAll(editing.id) { it.copy(body = text, edited = true) }
            _draft.value = ""
            _ui.update { it.copy(editing = null) }
            viewModelScope.launch {
                when (val r = repo.edit(editing.id, text)) {
                    is Result.Success -> {
                        mapAll(editing.id) { r.data }
                        notice("Komentar diperbarui")
                    }
                    is Result.Error -> {
                        mapAll(editing.id) { editing }
                        notice(r.message)
                    }
                    else -> mapAll(editing.id) { editing }
                }
            }
            return
        }
        val me = user.value ?: return
        val target = s.replyingTo
        val rootId = target?.let { it.parentId ?: it.id }
        val tmp = CommentDto(
            id = TMP + System.nanoTime(),
            parentId = rootId,
            replyTo = target?.user?.username,
            body = text,
            createdAt = System.currentTimeMillis(),
            user = me
        )
        _draft.value = ""
        _ui.update { addLocal(it, tmp) }
        viewModelScope.launch {
            when (val r = repo.post(source, slug, chapter, target?.id, text)) {
                is Result.Success -> {
                    val c = r.data.comment
                    mapAll(tmp.id) { c }
                    notice(
                        when {
                            r.data.xpGained > 0 -> "Terkirim · +${r.data.xpGained} XP"
                            r.data.xpReason == "LOW_QUALITY" -> "Terkirim · komentar terlalu singkat, tidak dapat XP"
                            r.data.xpReason == "DAILY_CAP" -> "Terkirim · batas XP harian tercapai"
                            else -> "Terkirim"
                        }
                    )
                    if (c.parentId != null && (_ui.value.replies[c.parentId]?.page ?: 0) == 0) loadReplies(c.parentId)
                }
                is Result.Error -> {
                    dropLocal(tmp.id, rootId)
                    if (_draft.value.isEmpty()) _draft.value = text
                    notice(r.message)
                }
                else -> {
                    dropLocal(tmp.id, rootId)
                    if (_draft.value.isEmpty()) _draft.value = text
                }
            }
        }
    }

    fun toggleLike(c: CommentDto) {
        if (c.id.startsWith(TMP)) return
        if (user.value == null) { notice("Masuk dulu untuk menyukai komentar"); return }
        val on = !c.liked
        mapAll(c.id) { it.copy(liked = on, likeCount = (it.likeCount + if (on) 1 else -1).coerceAtLeast(0)) }
        viewModelScope.launch {
            when (val r = repo.like(c.id, on)) {
                is Result.Success -> mapAll(c.id) { it.copy(liked = r.data.liked, likeCount = r.data.likeCount) }
                is Result.Error -> {
                    mapAll(c.id) { it.copy(liked = c.liked, likeCount = c.likeCount) }
                    notice(r.message)
                }
                else -> Unit
            }
        }
    }

    fun delete(c: CommentDto) {
        viewModelScope.launch {
            when (val r = repo.delete(c.id)) {
                is Result.Success -> {
                    _ui.update { st ->
                        val rootId = c.parentId
                        if (rootId == null) {
                            if (c.replyCount > 0) st.copy(total = (st.total - 1).coerceAtLeast(0), items = st.items.map { if (it.id == c.id) it.copy(deleted = true, body = "", canEdit = false, canDelete = false) else it })
                            else st.copy(total = (st.total - 1).coerceAtLeast(0), items = st.items.filter { it.id != c.id })
                        } else {
                            val root = st.items.firstOrNull { it.id == rootId }
                            val left = ((root?.replyCount ?: 1) - 1).coerceAtLeast(0)
                            val drop = root != null && root.deleted && left == 0
                            val items = st.items.mapNotNull { if (it.id != rootId) it else if (drop) null else it.copy(replyCount = left) }
                            val cur = st.replies[rootId]
                            st.copy(
                                total = (st.total - 1).coerceAtLeast(0),
                                items = items,
                                replies = if (cur == null) st.replies else st.replies + (rootId to cur.copy(items = cur.items.filter { it.id != c.id }))
                            )
                        }
                    }
                    notice("Komentar dihapus")
                    repo.refreshMe()
                }
                is Result.Error -> notice(r.message)
                else -> Unit
            }
        }
    }

    fun report(c: CommentDto, reason: String) {
        viewModelScope.launch {
            when (val r = repo.report(c.id, reason, "")) {
                is Result.Success -> notice("Laporan terkirim, terima kasih")
                is Result.Error -> notice(r.message)
                else -> Unit
            }
        }
    }

    fun signIn(idToken: String) {
        viewModelScope.launch {
            when (val r = repo.signInWithGoogle(idToken)) {
                is Result.Success -> {
                    notice("Masuk sebagai @${r.data.username}")
                    load()
                }
                is Result.Error -> notice(r.message)
                else -> Unit
            }
        }
    }

    companion object {
        const val MAX_LEN = 1000
        const val TMP = "tmp-"
    }
}
