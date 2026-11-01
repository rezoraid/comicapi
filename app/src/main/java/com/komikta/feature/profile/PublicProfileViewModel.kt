package com.komikta.feature.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.komikta.core.common.Result
import com.komikta.data.remote.dto.PublicReadingHistoryDto
import com.komikta.data.repository.CommunityRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PublicProfileViewModel @Inject constructor(
    private val repository: CommunityRepository
) : ViewModel() {
    private val _loading = MutableStateFlow(false)
    val loading = _loading.asStateFlow()
    private val _profile = MutableStateFlow<PublicReadingHistoryDto?>(null)
    val profile = _profile.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()
    private var loadedId: String? = null

    fun load(userId: String) {
        if (userId.isBlank() || loadedId == userId) return
        loadedId = userId
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            when (val result = repository.publicReadingHistory(userId)) {
                is Result.Success -> _profile.value = result.data
                is Result.Error -> _error.value = result.message
                else -> Unit
            }
            _loading.value = false
        }
    }
}
