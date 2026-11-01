package com.komikta.feature.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.komikta.core.common.Result
import com.komikta.data.local.dao.BookmarkDao
import com.komikta.data.local.dao.ReadingHistoryDao
import com.komikta.data.local.entity.BookmarkEntity
import com.komikta.data.local.entity.ReadingHistoryEntity
import com.komikta.data.repository.CommunityRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProfileUiState(val busy: Boolean = false, val message: String? = null)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val repo: CommunityRepository,
    bookmarkDao: BookmarkDao,
    historyDao: ReadingHistoryDao
) : ViewModel() {
    val user = repo.user
    val bookmarks: StateFlow<List<BookmarkEntity>> = bookmarkDao.getAll().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val history: StateFlow<List<ReadingHistoryEntity>> = historyDao.getRecentHistory(30).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    private val _ui = MutableStateFlow(ProfileUiState())
    val ui: StateFlow<ProfileUiState> = _ui.asStateFlow()

    init { if (repo.user.value != null) viewModelScope.launch { repo.refreshMe() } }

    fun refresh() { if (repo.user.value != null) viewModelScope.launch { repo.refreshMe() } }

    fun busy(b: Boolean) { _ui.value = _ui.value.copy(busy = b) }

    fun message(msg: String?) { _ui.value = _ui.value.copy(message = msg) }

    fun signIn(idToken: String) {
        viewModelScope.launch {
            _ui.value = ProfileUiState(busy = true)
            when (val r = repo.signInWithGoogle(idToken)) {
                is Result.Success -> { _ui.value = ProfileUiState(); repo.refreshMe() }
                is Result.Error -> _ui.value = ProfileUiState(message = r.message)
                else -> _ui.value = ProfileUiState()
            }
        }
    }

    fun signOut() {
        repo.signOut()
        _ui.value = ProfileUiState()
    }

    fun deleteAccount() {
        viewModelScope.launch {
            _ui.value = ProfileUiState(busy = true)
            when (val r = repo.deleteAccount()) {
                is Result.Success -> _ui.value = ProfileUiState(message = "Akun dihapus")
                is Result.Error -> _ui.value = ProfileUiState(message = r.message)
                else -> _ui.value = ProfileUiState()
            }
        }
    }

    fun setHistoryVisibility(isPublic: Boolean) {
        viewModelScope.launch {
            when (val r = repo.setReadingHistoryPublic(isPublic)) {
                is Result.Success -> _ui.value = ProfileUiState(message = if (isPublic) "Riwayat sekarang publik" else "Riwayat sekarang privat")
                is Result.Error -> _ui.value = ProfileUiState(message = r.message)
                else -> Unit
            }
        }
    }

    fun changeAvatar(imageData: String) {
        viewModelScope.launch {
            _ui.value = ProfileUiState(busy = true)
            when (val r = repo.updateAvatar(imageData)) {
                is Result.Success -> _ui.value = ProfileUiState(message = "Foto profil diperbarui")
                is Result.Error -> _ui.value = ProfileUiState(message = r.message)
                else -> _ui.value = ProfileUiState()
            }
        }
    }

    fun changeUsername(username: String, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            _ui.value = ProfileUiState(busy = true)
            when (val r = repo.updateUsername(username)) {
                is Result.Success -> { _ui.value = ProfileUiState(message = "Username diperbarui"); onDone(true) }
                is Result.Error -> { _ui.value = ProfileUiState(message = r.message); onDone(false) }
                else -> { _ui.value = ProfileUiState(); onDone(false) }
            }
        }
    }
}
