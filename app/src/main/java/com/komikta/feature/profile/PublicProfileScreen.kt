package com.komikta.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.komikta.ui.components.AppIcons
import com.komikta.ui.components.Avatar
import com.komikta.ui.components.CoverImage
import com.komikta.ui.components.RoleBadge
import com.komikta.ui.theme.Ui

@Composable
fun PublicProfileScreen(
    userId: String,
    onBack: () -> Unit,
    onComicClick: (String, String, String) -> Unit,
    viewModel: PublicProfileViewModel = hiltViewModel()
) {
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    val profile by viewModel.profile.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()
    LaunchedEffect(userId) { viewModel.load(userId) }

    Column(Modifier.fillMaxSize().background(Ui.Bg)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(AppIcons.chevronLeft, "Kembali", tint = Color.White) }
            Text("Profil pembaca", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        }
        when {
            loading && profile == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Ui.Accent) }
            profile != null -> {
                val data = profile!!
                LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                    item {
                        Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            Avatar(data.user.picture, data.user.name.ifBlank { data.user.username }, 64.dp)
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(data.user.name.ifBlank { data.user.username }, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)
                                Text("@${data.user.username}", fontSize = 13.sp, color = Ui.Text2)
                                if (data.user.role != "USER") RoleBadge(data.user.role)
                                Text("Level ${data.user.level} · ${data.user.commentCount.coerceAtLeast(0)} komentar", fontSize = 12.sp, color = Ui.Text3)
                            }
                        }
                        Text("Riwayat membaca", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White, modifier = Modifier.padding(start = 18.dp, end = 18.dp, top = 8.dp, bottom = 10.dp))
                    }
                    if (data.items.isEmpty()) item { Text("Belum ada riwayat membaca yang ditampilkan.", color = Ui.Text2, fontSize = 13.sp, modifier = Modifier.padding(18.dp)) }
                    items(data.items, key = { "${it.source}:${it.slug}" }) { item ->
                        Row(
                            Modifier.fillMaxWidth().clickable { onComicClick(item.source, item.slug, item.chapter) }.padding(horizontal = 18.dp, vertical = 7.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically
                        ) {
                            CoverImage(item.coverUrl, item.comicTitle, Modifier.size(width = 62.dp, height = 84.dp).clip(RoundedCornerShape(5.dp)), 150, 210)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(item.comicTitle.ifBlank { item.slug }, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(item.chapterTitle.ifBlank { item.chapter }, fontSize = 12.sp, color = Ui.Text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text("Terakhir dibaca · ${android.text.format.DateUtils.getRelativeTimeSpanString(item.updatedAt, System.currentTimeMillis(), android.text.format.DateUtils.MINUTE_IN_MILLIS)}", fontSize = 11.sp, color = Ui.Text3)
                            }
                            Icon(AppIcons.chevronRight, null, tint = Ui.Text3, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
            else -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                Text(error ?: "Profil tidak tersedia atau riwayatnya privat.", color = Ui.Text2)
            }
        }
    }
}
