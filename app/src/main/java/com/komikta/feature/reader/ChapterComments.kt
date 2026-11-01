package com.komikta.feature.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.komikta.data.remote.dto.CommentDto
import com.komikta.data.remote.dto.CommentPageDto
import com.komikta.ui.components.AppIcons
import com.komikta.ui.components.Avatar
import com.komikta.ui.components.relativeTime
import com.komikta.ui.theme.Ui

@Composable
fun ChapterCommentsSection(chapterSlug: String, load: suspend (String) -> CommentPageDto?, onOpen: () -> Unit) {
    var page by remember(chapterSlug) { mutableStateOf<CommentPageDto?>(null) }
    var done by remember(chapterSlug) { mutableStateOf(false) }
    LaunchedEffect(chapterSlug) {
        page = load(chapterSlug)
        done = true
    }
    val items = remember(page) { page?.items.orEmpty().filter { !it.deleted }.take(3) }
    Column(
        Modifier
            .fillMaxWidth()
            .background(Color.Black)
            .padding(horizontal = 16.dp)
            .padding(top = 24.dp)
    ) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Ui.Card).padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Icon(AppIcons.comment, null, tint = Ui.Accent, modifier = Modifier.size(18.dp))
                Text("Komentar chapter", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color.White, modifier = Modifier.padding(start = 8.dp).weight(1f))
                val total = page?.total ?: 0
                if (total > 0) Text("$total", fontSize = 13.sp, color = Ui.Text2)
            }
            when {
                !done -> Text("Memuat komentar…", fontSize = 13.sp, color = Ui.Text3, modifier = Modifier.padding(top = 14.dp))
                page == null -> Text("Komentar belum bisa dimuat", fontSize = 13.sp, color = Ui.Text3, modifier = Modifier.padding(top = 14.dp))
                items.isEmpty() -> Text("Belum ada komentar. Jadilah yang pertama menanggapi chapter ini.", fontSize = 13.sp, lineHeight = 19.sp, color = Ui.Text2, modifier = Modifier.padding(top = 14.dp))
                else -> Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    items.forEach { CommentLine(it, onOpen) }
                }
            }
            Text(
                if ((page?.total ?: 0) > items.size) "Lihat semua komentar" else "Tulis komentar",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = Ui.OnAccent,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .padding(top = 14.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(Ui.AccentBrush)
                    .clickable(onClick = onOpen)
                    .padding(vertical = 11.dp)
            )
        }
    }
}

@Composable
private fun CommentLine(c: CommentDto, onOpen: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).clickable(onClick = onOpen).padding(vertical = 8.dp)) {
        Avatar(c.user.picture, c.user.name.ifBlank { c.user.username }, 30.dp)
        Column(Modifier.weight(1f).padding(start = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(c.user.username, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Text(relativeTime(c.createdAt, System.currentTimeMillis()), fontSize = 11.sp, color = Ui.Text3, maxLines = 1)
            }
            Text(c.body, fontSize = 13.sp, lineHeight = 18.sp, color = Color(0xFFC3CBCE), maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
            if (c.likeCount > 0 || c.replyCount > 0) {
                Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (c.likeCount > 0) Text("♥ ${c.likeCount}", fontSize = 11.sp, color = Ui.Text2)
                    if (c.replyCount > 0) Text("${c.replyCount} balasan", fontSize = 11.sp, color = Ui.Text2)
                }
            }
        }
    }
}
