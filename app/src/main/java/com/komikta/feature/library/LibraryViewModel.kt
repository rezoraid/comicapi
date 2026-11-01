package com.komikta.feature.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.komikta.data.local.dao.BookmarkDao
import com.komikta.data.local.dao.ReadingHistoryDao
import com.komikta.data.local.entity.BookmarkEntity
import com.komikta.data.local.entity.ReadingHistoryEntity
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class LibraryViewModel @Inject constructor(
    bookmarkDao: BookmarkDao,
    historyDao: ReadingHistoryDao
) : ViewModel() {

    val bookmarks: StateFlow<List<BookmarkEntity>> = bookmarkDao.getAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val history: StateFlow<List<ReadingHistoryEntity>> = historyDao.getRecentHistory(50)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
}
