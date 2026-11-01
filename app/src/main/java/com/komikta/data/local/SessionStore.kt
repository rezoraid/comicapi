package com.komikta.data.local

import android.content.Context
import com.komikta.data.remote.dto.CommunityUserDto
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SessionStore @Inject constructor(
    @ApplicationContext context: Context,
    private val json: Json
) {
    private val sp = context.getSharedPreferences("komikta_session", Context.MODE_PRIVATE)
    private val _user = MutableStateFlow(readUser())
    val user: StateFlow<CommunityUserDto?> = _user.asStateFlow()

    @Volatile
    var token: String? = sp.getString("token", null)
        private set

    private fun readUser(): CommunityUserDto? {
        if (sp.getString("token", null).isNullOrBlank()) return null
        val raw = sp.getString("user", null) ?: return null
        return runCatching { json.decodeFromString(CommunityUserDto.serializer(), raw) }.getOrNull()
    }

    fun save(token: String, user: CommunityUserDto) {
        this.token = token
        sp.edit().putString("token", token).putString("user", json.encodeToString(CommunityUserDto.serializer(), user)).apply()
        _user.value = user
    }

    fun update(incoming: CommunityUserDto) {
        if (token == null) return
        val old = _user.value
        val user = if (incoming.commentCount < 0 && old != null && old.id == incoming.id) incoming.copy(commentCount = old.commentCount) else incoming
        sp.edit().putString("user", json.encodeToString(CommunityUserDto.serializer(), user)).apply()
        _user.value = user
    }

    fun updateToken(value: String) {
        if (token == null) return
        token = value
        sp.edit().putString("token", value).apply()
    }

    fun clear() {
        token = null
        sp.edit().clear().apply()
        _user.value = null
    }
}
