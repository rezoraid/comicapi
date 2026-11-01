package com.komikta.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.komikta.domain.model.Comic
import com.komikta.ui.theme.Ui

private val CoverShape = RoundedCornerShape(4.dp)
private val RowShape = RoundedCornerShape(4.dp)

@Composable
fun PosterCard(
    title: String,
    coverUrl: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    badge: String? = null,
    rating: String? = null,
    meta: String? = null,
    chapters: List<Pair<String, String?>> = emptyList()
) {
    Column(modifier.clickable(onClick = onClick)) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(0.72f)
                .clip(CoverShape)
                .background(Ui.Card)
        ) {
            CoverImage(url = coverUrl, contentDescription = title, modifier = Modifier.fillMaxSize())
            if (rating != null) Tag(rating, Modifier.align(Alignment.TopStart).padding(4.dp))
            if (badge != null) Tag(badge, Modifier.align(Alignment.BottomEnd).padding(4.dp))
        }
        Text(
            text = title,
            fontSize = 13.sp,
            lineHeight = 17.sp,
            fontWeight = FontWeight.SemiBold,
            color = Color.White,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 7.dp)
        )
        if (chapters.isNotEmpty()) {
            Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                chapters.forEach { (name, ago) -> ChapterLine(name, ago) }
            }
        } else if (meta != null) {
            Text(
                text = meta,
                fontSize = 11.sp,
                color = Ui.Text2,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 3.dp)
            )
        }
    }
}

@Composable
private fun ChapterLine(name: String, ago: String?) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RowShape)
            .background(Ui.Chip)
            .padding(horizontal = 6.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(name, fontSize = 10.sp, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        if (!ago.isNullOrBlank()) {
            Text(ago, fontSize = 10.sp, color = Ui.Text3, maxLines = 1, modifier = Modifier.weight(1f).padding(start = 6.dp), textAlign = androidx.compose.ui.text.style.TextAlign.End)
        }
    }
}

@Composable
private fun Tag(text: String, modifier: Modifier) {
    Text(
        text = text,
        fontSize = 9.sp,
        fontWeight = FontWeight.SemiBold,
        color = Color.White,
        maxLines = 1,
        modifier = modifier
            .background(Ui.Badge, RoundedCornerShape(3.dp))
            .padding(horizontal = 4.dp, vertical = 2.dp)
    )
}

@Composable
fun ComicCard(
    comic: Comic,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val badge = remember(comic) {
        comic.type?.trim()?.takeIf { it.isNotEmpty() }?.replaceFirstChar { it.uppercase() }
    }
    val rating = remember(comic) {
        comic.rating?.takeIf { it > 0.0 }?.let { "★ ${fmtRating(it)}" }
    }
    val chapters = remember(comic) {
        comic.chapters.take(2).mapNotNull { c ->
            val name = cleanNumber(c.number)?.let { "Chapter $it" } ?: c.title?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            name to c.timeAgo
        }
    }
    val meta = remember(comic) { comic.status?.takeIf { it.isNotBlank() } }
    PosterCard(
        title = comic.title,
        coverUrl = comic.coverUrl,
        onClick = onClick,
        modifier = modifier,
        badge = badge,
        rating = rating,
        meta = meta,
        chapters = chapters
    )
}
