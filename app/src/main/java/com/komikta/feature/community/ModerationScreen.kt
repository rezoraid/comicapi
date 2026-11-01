package com.komikta.feature.community

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.komikta.data.remote.dto.ReportDto
import com.komikta.ui.components.AppIcons
import com.komikta.ui.components.Chip
import com.komikta.ui.components.RoleBadge
import com.komikta.ui.components.relativeTime
import com.komikta.ui.theme.Ui
import kotlinx.coroutines.delay

private val Soft = Color(0xFFC3CBCE)
private val ReasonLabel = mapOf("spam" to "Spam", "abuse" to "Kasar / pelecehan", "hate" to "SARA / kebencian", "spoiler" to "Spoiler", "other" to "Lainnya")

@Composable
fun ModerationScreen(onBack: () -> Unit, viewModel: ModerationViewModel = hiltViewModel()) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()

    LaunchedEffect(ui.notice) {
        if (ui.notice != null) {
            delay(2600)
            viewModel.clearNotice()
        }
    }

    Column(Modifier.fillMaxSize().background(Ui.Bg).statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(AppIcons.chevronLeft, "Back", tint = Color.White, modifier = Modifier.size(24.dp)) }
            Text("Moderasi", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        }
        ui.notice?.let { Text(it, fontSize = 12.sp, color = Soft, modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp)) }
        when {
            ui.loading && ui.items.isEmpty() -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Text("Memuat…", color = Ui.Text2) }
            ui.error != null && ui.items.isEmpty() -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(ui.error ?: "Error", color = Ui.Text2)
                    TextButton(onClick = viewModel::load) { Text("Coba lagi", color = Ui.Accent) }
                }
            }
            ui.items.isEmpty() -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Text("Tidak ada laporan terbuka.", color = Ui.Text2, fontSize = 14.sp) }
            else -> LazyColumn(Modifier.weight(1f), contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(ui.items, key = { it.id }, contentType = { "report" }) { r -> ReportCard(r, viewModel) }
                if (ui.hasMore) item(key = "more") {
                    LaunchedEffect(ui.page) { viewModel.loadMore() }
                    Text(if (ui.loadingMore) "Memuat…" else "Muat lagi", fontSize = 13.sp, color = Ui.Text2, modifier = Modifier.padding(8.dp))
                }
            }
        }
    }
}

@Composable
private fun ReportCard(r: ReportDto, vm: ModerationViewModel) {
    val c = r.comment
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Ui.Card).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(ReasonLabel[r.reason] ?: r.reason, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text("${c?.reportCount ?: 1} laporan", fontSize = 11.sp, color = Ui.Text3)
            Text(relativeTime(r.createdAt, System.currentTimeMillis()), fontSize = 11.sp, color = Ui.Text3)
        }
        if (c == null || c.deleted) {
            Text("Komentar sudah dihapus", fontSize = 13.sp, fontStyle = FontStyle.Italic, color = Ui.Text3)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("@${c.user?.username ?: "?"}", fontSize = 12.sp, color = Ui.Text2)
                c.user?.let { if (it.role != "USER") RoleBadge(it.role) }
            }
            Text(c.body, fontSize = 14.sp, lineHeight = 20.sp, color = Soft)
            Text(c.targetKey, fontSize = 11.sp, color = Ui.Text3, maxLines = 1)
        }
        if (r.note.isNotBlank()) Text("Catatan: ${r.note}", fontSize = 12.sp, color = Ui.Text2)
        r.reporter?.let { Text("Pelapor: @${it.username}", fontSize = 11.sp, color = Ui.Text3) }
        Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (c != null && !c.deleted) Chip("Hapus komentar", selected = true, onClick = { vm.resolve(r, "delete") })
            Chip("Abaikan", selected = false, onClick = { vm.resolve(r, "dismiss") })
        }
    }
}
