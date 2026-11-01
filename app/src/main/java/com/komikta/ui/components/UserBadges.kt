package com.komikta.ui.components

import com.komikta.BuildConfig

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.komikta.ui.theme.Ui

private val BadgeShape = RoundedCornerShape(5.dp)

@Composable
fun RoleBadge(role: String, modifier: Modifier = Modifier) {
    val base = modifier.clip(BadgeShape)
    when (role) {
        "OWNER" -> Text("OWNER", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color.White, modifier = base.background(Color(0xFF1769E0)).border(1.dp, Color(0xFF78B7FF), BadgeShape).padding(horizontal = 6.dp, vertical = 2.dp))
        "MODERATOR" -> Text("MOD", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color(0xFF78B7FF), modifier = base.background(Color(0xFF102B4E)).border(1.dp, Color(0xFF1769E0), BadgeShape).padding(horizontal = 6.dp, vertical = 1.dp))
        "PREMIUM" -> Text("PREMIUM", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color.White, modifier = base.background(Color(0xFF1769E0)).border(1.dp, Color(0xFF78B7FF), BadgeShape).padding(horizontal = 6.dp, vertical = 2.dp))
        else -> Text("USER", fontSize = 9.sp, fontWeight = FontWeight.Medium, color = Ui.Text2, modifier = base.background(Ui.Chip).padding(horizontal = 6.dp, vertical = 2.dp))
    }
}

@Composable
fun LevelChip(level: Int, modifier: Modifier = Modifier) {
    Text(
        "Lv $level",
        fontSize = 10.sp,
        fontWeight = FontWeight.Medium,
        color = Color(0xFF78B7FF),
        modifier = modifier.clip(BadgeShape).background(Color(0xFF102B4E)).border(1.dp, Color(0xFF1769E0), BadgeShape).padding(horizontal = 6.dp, vertical = 2.dp)
    )
}

@Composable
fun Avatar(url: String?, name: String, size: Dp, modifier: Modifier = Modifier) {
    val frame = modifier.size(size).clip(CircleShape).background(Ui.Chip)
    if (url.isNullOrBlank()) {
        Box(frame, contentAlignment = Alignment.Center) {
            Text(name.trim().take(1).uppercase().ifEmpty { "?" }, fontSize = (size.value * 0.42f).sp, fontWeight = FontWeight.SemiBold, color = Color.White)
        }
    } else {
        CoverImage(url = if (url.startsWith("/")) BuildConfig.BASE_URL.trimEnd('/') + url else url, contentDescription = name, widthPx = 160, heightPx = 160, modifier = frame)
    }
}
