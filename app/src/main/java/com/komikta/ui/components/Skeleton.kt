package com.komikta.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.komikta.ui.theme.Ui

private val BlockShape = RoundedCornerShape(10.dp)
private val ShimmerColors = listOf(Ui.Card, Color(0xFF1F2A2F), Ui.Card)

@Composable
fun shimmerBrush(): Brush {
    val x by rememberInfiniteTransition(label = "shimmer").animateFloat(
        initialValue = -600f,
        targetValue = 1400f,
        animationSpec = infiniteRepeatable(tween(1200, easing = LinearEasing), RepeatMode.Restart),
        label = "shimmerX"
    )
    return Brush.linearGradient(ShimmerColors, Offset(x, 0f), Offset(x + 600f, 300f))
}

@Composable
fun SkeletonBlock(modifier: Modifier = Modifier, brush: Brush = shimmerBrush()) {
    Box(modifier.background(brush, BlockShape))
}

@Composable
fun PosterSkeleton(modifier: Modifier = Modifier, brush: Brush = shimmerBrush()) {
    Column(modifier) {
        SkeletonBlock(Modifier.fillMaxWidth().aspectRatio(0.72f), brush)
        Spacer(Modifier.height(8.dp))
        SkeletonBlock(Modifier.fillMaxWidth(0.9f).height(12.dp), brush)
        Spacer(Modifier.height(5.dp))
        SkeletonBlock(Modifier.fillMaxWidth(0.55f).height(10.dp), brush)
    }
}

@Composable
fun PosterRowSkeleton(rows: Int = 2) {
    val brush = shimmerBrush()
    Column(
        Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        repeat(rows) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                repeat(3) { PosterSkeleton(Modifier.weight(1f), brush) }
            }
        }
    }
}

@Composable
fun DetailSkeleton() {
    val brush = shimmerBrush()
    Column(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row {
            SkeletonBlock(Modifier.width(110.dp).height(154.dp), brush)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SkeletonBlock(Modifier.fillMaxWidth().height(22.dp), brush)
                SkeletonBlock(Modifier.fillMaxWidth(0.55f).height(14.dp), brush)
                SkeletonBlock(Modifier.fillMaxWidth(0.4f).height(14.dp), brush)
            }
        }
        SkeletonBlock(Modifier.fillMaxWidth().height(48.dp), brush)
        SkeletonBlock(Modifier.fillMaxWidth().height(70.dp), brush)
        repeat(6) { SkeletonBlock(Modifier.fillMaxWidth().height(44.dp), brush) }
    }
}
