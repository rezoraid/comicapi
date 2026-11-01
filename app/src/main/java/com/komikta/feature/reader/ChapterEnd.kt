package com.komikta.feature.reader

import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.komikta.domain.model.Chapter
import com.komikta.ui.components.AppIcons
import com.komikta.ui.components.cleanNumber
import com.komikta.ui.theme.Ui

@Composable
fun ChapterEnd(
    current: Chapter?,
    fallbackTitle: String?,
    nextSlug: String?,
    next: Chapter?,
    onNext: (() -> Unit)?,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    onComments: (() -> Unit)? = null
) {
    val currentNumber = cleanNumber(current?.number)
    val doneText = currentNumber?.let { "Chapter $it selesai" }
        ?: fallbackTitle?.takeIf { it.isNotBlank() }?.let { "$it selesai" }
        ?: "Chapter selesai"
    val hasNext = !nextSlug.isNullOrBlank()

    val nextNumber = cleanNumber(next?.number)
    val nextTitle = next?.title?.trim()?.takeIf { it.isNotEmpty() && cleanNumber(it) != nextNumber }
    val nextLabel = nextNumber?.let { "Chapter $it" } ?: nextTitle

    Box(
        modifier
            .fillMaxWidth()
            .background(Color.Black)
            .padding(horizontal = 16.dp)
            .padding(top = if (compact) 20.dp else 28.dp, bottom = if (compact) 20.dp else 120.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(Ui.Card)
                .padding(horizontal = 20.dp, vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(AppIcons.checkCircle, null, tint = Ui.Accent, modifier = Modifier.size(36.dp))
            Text(
                doneText,
                style = MaterialTheme.typography.titleMedium,
                color = Color.White,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 12.dp)
            )
            if (!hasNext) {
                Text(
                    "Kamu sudah membaca chapter terbaru",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Ui.Text2,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 6.dp)
                )
            } else {
                Column(
                    Modifier
                        .padding(top = 16.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .then(if (onNext != null) Modifier.clickable(onClick = onNext) else Modifier)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Icon(AppIcons.chevronsDown, "Chapter berikutnya", tint = Ui.Accent, modifier = Modifier.size(24.dp))
                    Text(
                        text = if (nextLabel != null) "Selanjutnya: $nextLabel" else "Chapter selanjutnya",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Ui.Text2,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            if (onComments != null) {
                Row(
                    Modifier
                        .padding(top = 16.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Ui.Chip)
                        .clickable(onClick = onComments)
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(AppIcons.comment, null, tint = Color.White, modifier = Modifier.size(18.dp))
                    Text("Komentar", style = MaterialTheme.typography.labelLarge, color = Color.White)
                }
            }
        }
    }
}

@Composable
fun ChapterNav(
    hasPrev: Boolean,
    hasNext: Boolean,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onDetail: () -> Unit,
    modifier: Modifier = Modifier,
    onComments: (() -> Unit)? = null
) {
    Row(
        modifier
            .fillMaxWidth()
            .background(Color.Black)
            .padding(horizontal = 12.dp)
            .padding(top = 32.dp, bottom = 120.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        val prevColor = if (hasPrev) Color.White else Ui.Text3
        Row(
            Modifier
                .clip(RoundedCornerShape(12.dp))
                .then(if (hasPrev) Modifier.clickable(onClick = onPrev) else Modifier)
                .padding(horizontal = 12.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(AppIcons.chevronLeft, null, tint = prevColor, modifier = Modifier.size(20.dp))
            Text("Previous", style = MaterialTheme.typography.titleMedium, color = prevColor)
        }
        if (onComments != null) {
            Row(
                Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .clickable(onClick = onComments)
                    .padding(horizontal = 12.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(AppIcons.comment, null, tint = Color.White, modifier = Modifier.size(20.dp))
                Text("Komentar", style = MaterialTheme.typography.titleMedium, color = Color.White)
            }
        }
        Row(
            Modifier
                .clip(RoundedCornerShape(12.dp))
                .clickable(onClick = if (hasNext) onNext else onDetail)
                .padding(horizontal = 12.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(if (hasNext) "Next" else "Back to detail", style = MaterialTheme.typography.titleMedium, color = Color.White)
            if (hasNext) Icon(AppIcons.chevronRight, null, tint = Color.White, modifier = Modifier.size(20.dp))
        }
    }
}
