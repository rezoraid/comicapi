package com.komikta.feature.community

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.komikta.data.remote.dto.CommentDto
import com.komikta.feature.auth.rememberGoogleSignIn
import com.komikta.ui.components.AppIcons
import com.komikta.ui.components.Avatar
import com.komikta.ui.components.Chip
import com.komikta.ui.components.LevelChip
import com.komikta.ui.components.RoleBadge
import com.komikta.ui.components.SkeletonBlock
import com.komikta.ui.components.relativeTime
import com.komikta.ui.theme.Ui
import kotlinx.coroutines.delay

private val Soft = Color(0xFFC3CBCE)
private val ReportReasons = listOf("spam" to "Spam", "abuse" to "Kasar / pelecehan", "hate" to "SARA / kebencian", "spoiler" to "Spoiler", "other" to "Lainnya")

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CommentsScreen(onBack: () -> Unit, onUserClick: (String) -> Unit = {}, viewModel: CommentsViewModel = hiltViewModel()) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val me by viewModel.user.collectAsStateWithLifecycle()
    val draft by viewModel.draft.collectAsStateWithLifecycle()
    var deleteTarget by remember { mutableStateOf<CommentDto?>(null) }
    var reportTarget by remember { mutableStateOf<CommentDto?>(null) }
    val signIn = rememberGoogleSignIn(onToken = viewModel::signIn, onError = viewModel::notice)

    LaunchedEffect(ui.notice) {
        if (ui.notice != null) {
            delay(2600)
            viewModel.notice(null)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Ui.Bg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(AppIcons.chevronLeft, "Back", tint = Color.White, modifier = Modifier.size(24.dp)) }
            Column(Modifier.weight(1f)) {
                Text("Komentar", style = MaterialTheme.typography.titleLarge)
                Text(
                    if (viewModel.chapterLabel != null) "Chapter ${viewModel.chapterLabel}" else "Halaman komik",
                    fontSize = 12.sp,
                    color = Ui.Text3,
                    maxLines = 1
                )
            }
            if (!ui.loading && ui.error == null) Text("${ui.total}", fontSize = 13.sp, color = Ui.Text2, modifier = Modifier.padding(end = 14.dp))
        }
        Row(Modifier.padding(horizontal = 14.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("Terbaru", selected = ui.sort == "newest", onClick = { viewModel.setSort("newest") })
            Chip("Teratas", selected = ui.sort == "top", onClick = { viewModel.setSort("top") })
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Ui.Line))

        when {
            ui.loading && ui.items.isEmpty() -> Column(Modifier.weight(1f).padding(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                repeat(5) { SkeletonBlock(Modifier.fillMaxWidth().height(56.dp)) }
            }
            ui.error != null && ui.items.isEmpty() -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(ui.error ?: "Error", color = Ui.Text2)
                    TextButton(onClick = viewModel::load) { Text("Coba lagi", color = Ui.Accent) }
                }
            }
            ui.items.isEmpty() -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text("Belum ada komentar. Jadilah yang pertama.", color = Ui.Text2, fontSize = 14.sp)
            }
            else -> LazyColumn(Modifier.weight(1f)) {
                ui.items.forEach { root ->
                    item(key = root.id, contentType = "comment") {
                        CommentRow(root, false, me?.id, viewModel, { deleteTarget = it }, { reportTarget = it }, onUserClick)
                    }
                    val rs = ui.replies[root.id]
                    if (root.replyCount > 0) {
                        item(key = "toggle-${root.id}", contentType = "toggle") {
                            Text(
                                if (rs?.expanded == true) "Sembunyikan balasan" else "Lihat ${root.replyCount} balasan",
                                fontSize = 12.sp,
                                color = Ui.Text2,
                                modifier = Modifier.padding(start = 62.dp, top = 2.dp, bottom = 8.dp).clickable { viewModel.toggleReplies(root) }
                            )
                        }
                    }
                    if (rs?.expanded == true) {
                        items(rs.items, key = { it.id }, contentType = { "reply" }) { reply ->
                            CommentRow(reply, true, me?.id, viewModel, { deleteTarget = it }, { reportTarget = it }, onUserClick)
                        }
                        if (rs.loading) item(key = "rl-${root.id}", contentType = "more") { Text("Memuat balasan…", fontSize = 12.sp, color = Ui.Text3, modifier = Modifier.padding(start = 62.dp, bottom = 8.dp)) }
                        else if (rs.hasMore && rs.page > 0) item(key = "rm-${root.id}", contentType = "more") {
                            Text("Balasan lainnya", fontSize = 12.sp, color = Ui.Text2, modifier = Modifier.padding(start = 62.dp, bottom = 10.dp).clickable { viewModel.loadReplies(root.id) })
                        }
                    }
                }
                if (ui.hasMore) item(key = "more", contentType = "more") {
                    LaunchedEffect(ui.page) { viewModel.loadMore() }
                    Text(
                        if (ui.loadingMore) "Memuat…" else "Muat komentar lainnya",
                        fontSize = 13.sp,
                        color = Ui.Text2,
                        modifier = Modifier.fillMaxWidth().clickable { viewModel.loadMore() }.padding(16.dp)
                    )
                }
            }
        }

        Column(Modifier.fillMaxWidth().background(Ui.Bar)) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(Ui.Line))
            ui.notice?.let { Text(it, fontSize = 12.sp, color = Soft, modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp)) }
            val target = ui.replyingTo
            if (target != null || ui.editing != null) {
                Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (ui.editing != null) "Mengedit komentar" else "Membalas @${target?.user?.username}",
                        fontSize = 12.sp,
                        color = Ui.Text2,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    IconButton(onClick = viewModel::cancelCompose) { Icon(AppIcons.close, "Batal", tint = Ui.Text2, modifier = Modifier.size(18.dp)) }
                }
            }
            if (me == null) {
                Text(
                    "Masuk dengan Google untuk berkomentar",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    color = Ui.OnAccent,
                    modifier = Modifier
                        .padding(horizontal = 14.dp, vertical = 10.dp)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Ui.AccentBrush)
                        .clickable(onClick = signIn)
                        .padding(vertical = 12.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            } else {
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(Ui.Card).padding(horizontal = 14.dp, vertical = 10.dp)) {
                        if (draft.isEmpty()) Text("Tulis komentar…", fontSize = 14.sp, color = Ui.Text3)
                        BasicTextField(
                            value = draft,
                            onValueChange = viewModel::setDraft,
                            maxLines = 5,
                            textStyle = MaterialTheme.typography.bodyLarge,
                            cursorBrush = SolidColor(Ui.Accent),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    val canSend = draft.isNotBlank() && !ui.sending
                    IconButton(onClick = viewModel::submit, enabled = canSend) {
                        Icon(AppIcons.send, "Kirim", tint = if (canSend) Ui.Accent else Ui.Text3, modifier = Modifier.size(24.dp))
                    }
                }
                if (draft.length > 800) Text("${draft.length}/${CommentsViewModel.MAX_LEN}", fontSize = 11.sp, color = Ui.Text3, modifier = Modifier.padding(start = 14.dp, bottom = 6.dp))
            }
        }
    }

    deleteTarget?.let { c ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            containerColor = Ui.Card,
            title = { Text("Hapus komentar?", style = MaterialTheme.typography.titleMedium) },
            text = { Text("Komentar yang dihapus tidak bisa dikembalikan.", color = Ui.Text2, fontSize = 14.sp) },
            confirmButton = { TextButton(onClick = { viewModel.delete(c); deleteTarget = null }) { Text("Hapus", color = Ui.Accent) } },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("Batal", color = Ui.Text2) } }
        )
    }

    reportTarget?.let { c ->
        var reason by remember(c.id) { mutableStateOf("spam") }
        AlertDialog(
            onDismissRequest = { reportTarget = null },
            containerColor = Ui.Card,
            title = { Text("Laporkan komentar", style = MaterialTheme.typography.titleMedium) },
            text = {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ReportReasons.forEach { (key, label) -> Chip(label, selected = reason == key, onClick = { reason = key }) }
                }
            },
            confirmButton = { TextButton(onClick = { viewModel.report(c, reason); reportTarget = null }) { Text("Kirim", color = Ui.Accent) } },
            dismissButton = { TextButton(onClick = { reportTarget = null }) { Text("Batal", color = Ui.Text2) } }
        )
    }
}

@Composable
private fun CommentRow(
    c: CommentDto,
    isReply: Boolean,
    meId: String?,
    vm: CommentsViewModel,
    onDelete: (CommentDto) -> Unit,
    onReport: (CommentDto) -> Unit,
    onUserClick: (String) -> Unit
) {
    val avatar: Dp = if (isReply) 28.dp else 36.dp
    var menu by remember { mutableStateOf(false) }
    val canReport = !c.deleted && c.user.id != meId
    Row(Modifier.fillMaxWidth().padding(start = if (isReply) 50.dp else 14.dp, end = 8.dp, top = 8.dp, bottom = 4.dp)) {
        Box(Modifier.clickable { if (c.user.id.isNotBlank()) onUserClick(c.user.id) }) { Avatar(c.user.picture, c.user.name.ifBlank { c.user.username }, avatar) }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(c.user.username, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false).clickable { if (c.user.id.isNotBlank()) onUserClick(c.user.id) })
                if (c.user.role != "USER") RoleBadge(c.user.role)
                LevelChip(c.user.level)
                Text(relativeTime(c.createdAt, System.currentTimeMillis()) + if (c.edited && !c.deleted) " · diedit" else "", fontSize = 11.sp, color = Ui.Text3, maxLines = 1)
            }
            if (c.deleted) {
                Text("Komentar telah dihapus", fontSize = 13.sp, fontStyle = FontStyle.Italic, color = Ui.Text3, modifier = Modifier.padding(top = 4.dp))
            } else {
                Text(
                    text = (if (c.replyTo != null) "@${c.replyTo} " else "") + c.body,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    color = Soft,
                    modifier = Modifier.padding(top = 4.dp)
                )
                Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(Modifier.clip(RoundedCornerShape(6.dp)).clickable { vm.toggleLike(c) }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        Icon(AppIcons.heart(c.liked), "Suka", tint = if (c.liked) Ui.Accent else Ui.Text2, modifier = Modifier.size(17.dp))
                        if (c.likeCount > 0) Text("${c.likeCount}", fontSize = 12.sp, color = if (c.liked) Ui.Accent else Ui.Text2)
                    }
                    Text(
                        "Balas",
                        fontSize = 12.sp,
                        color = Ui.Text2,
                        modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable { if (meId == null) vm.notice("Masuk dulu untuk membalas") else vm.startReply(c) }.padding(vertical = 6.dp)
                    )
                    if (c.canEdit || c.canDelete || canReport) Box {
                        Icon(AppIcons.more, "Opsi", tint = Ui.Text2, modifier = Modifier.size(20.dp).clickable { menu = true })
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, modifier = Modifier.background(Ui.Card)) {
                            if (c.canEdit) DropdownMenuItem(text = { Text("Edit") }, onClick = { menu = false; vm.startEdit(c) })
                            if (c.canDelete) DropdownMenuItem(text = { Text("Hapus") }, onClick = { menu = false; onDelete(c) })
                            if (canReport) DropdownMenuItem(
                                text = { Text("Laporkan") },
                                onClick = { menu = false; if (meId == null) vm.notice("Masuk dulu untuk melaporkan") else onReport(c) }
                            )
                        }
                    }
                }
            }
        }
    }
}
