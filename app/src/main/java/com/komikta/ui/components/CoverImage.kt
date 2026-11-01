package com.komikta.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.ColorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil.compose.AsyncImage
import coil.request.ImageRequest
import coil.size.Size

private val Placeholder = ColorPainter(Color(0xFF151D20))

@Composable
fun CoverImage(
    url: String?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    widthPx: Int = 300,
    heightPx: Int = 420,
    alignment: Alignment = Alignment.Center
) {
    val context = LocalContext.current
    val request = remember(url, widthPx, heightPx) {
        ImageRequest.Builder(context)
            .data(url)
            .size(Size(widthPx, heightPx))
            .crossfade(120)
            .build()
    }
    AsyncImage(
        model = request,
        contentDescription = contentDescription,
        contentScale = ContentScale.Crop,
        alignment = alignment,
        placeholder = Placeholder,
        error = Placeholder,
        modifier = modifier
    )
}
