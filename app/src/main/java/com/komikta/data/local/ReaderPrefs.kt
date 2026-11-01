package com.komikta.data.local

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ReaderPrefs @Inject constructor(@ApplicationContext context: Context) {
    private val sp = context.getSharedPreferences("reader_prefs", Context.MODE_PRIVATE)
    private val _autoNext = MutableStateFlow(sp.getBoolean("auto_next", true))
    val autoNext: StateFlow<Boolean> = _autoNext.asStateFlow()
    private val _chaptersNewestFirst = MutableStateFlow(sp.getBoolean("chapters_newest_first", true))
    val chaptersNewestFirst: StateFlow<Boolean> = _chaptersNewestFirst.asStateFlow()
    fun setChaptersNewestFirst(v: Boolean) { sp.edit().putBoolean("chapters_newest_first", v).apply(); _chaptersNewestFirst.value = v }
    fun setAutoNext(v: Boolean) { sp.edit().putBoolean("auto_next", v).apply(); _autoNext.value = v }
}
