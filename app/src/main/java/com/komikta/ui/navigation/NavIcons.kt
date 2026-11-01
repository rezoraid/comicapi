package com.komikta.ui.navigation

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

internal fun navIcon(
    name: String,
    filled: Boolean,
    stroked: Boolean = true,
    strokeWidth: Float = 2f,
    build: PathBuilder.() -> Unit
): ImageVector =
    ImageVector.Builder(
        name = name,
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f
    ).path(
        fill = if (filled) SolidColor(Color.Black) else null,
        stroke = if (stroked) SolidColor(Color.Black) else null,
        strokeLineWidth = strokeWidth,
        strokeLineCap = StrokeCap.Round,
        strokeLineJoin = StrokeJoin.Round,
        pathFillType = PathFillType.EvenOdd,
        pathBuilder = build
    ).build()

internal fun PathBuilder.circle(cx: Float, cy: Float, r: Float) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, true, true, cx + r, cy)
    arcTo(r, r, 0f, true, true, cx - r, cy)
    close()
}

object NavIcons {
    fun home(filled: Boolean): ImageVector = navIcon("Home", filled, stroked = !filled) {
        moveTo(12f, 3.4f)
        lineTo(20.4f, 9.8f)
        lineTo(20.4f, 19.6f)
        lineTo(20.4f, 20.6f)
        lineTo(15.2f, 20.6f)
        lineTo(15.2f, 14.8f)
        lineTo(8.8f, 14.8f)
        lineTo(8.8f, 20.6f)
        lineTo(3.6f, 20.6f)
        lineTo(3.6f, 9.8f)
        close()
    }

    fun explore(filled: Boolean): ImageVector = navIcon("Explore", filled, stroked = !filled) {
        circle(12f, 12f, if (filled) 10f else 9f)
        moveTo(16.4f, 7.6f)
        lineTo(13.6f, 13.6f)
        lineTo(7.6f, 16.4f)
        lineTo(10.4f, 10.4f)
        close()
    }

    fun library(filled: Boolean): ImageVector = navIcon("Library", filled, stroked = !filled) {
        moveTo(3.4f, 4.2f)
        lineTo(7.6f, 4.2f)
        lineTo(7.6f, 19.8f)
        lineTo(3.4f, 19.8f)
        close()
        moveTo(8.8f, 4.2f)
        lineTo(13f, 4.2f)
        lineTo(13f, 19.8f)
        lineTo(8.8f, 19.8f)
        close()
        moveTo(14.5f, 5.6f)
        lineTo(18.2f, 4.8f)
        lineTo(20.8f, 19f)
        lineTo(17.1f, 19.8f)
        close()
    }

    fun profile(filled: Boolean): ImageVector = navIcon("Profile", filled, stroked = !filled) {
        circle(12f, 7.7f, if (filled) 4.7f else 3.8f)
        moveTo(3.6f, 20.8f)
        curveTo(3.6f, 16.3f, 7.4f, 13.6f, 12f, 13.6f)
        curveTo(16.6f, 13.6f, 20.4f, 16.3f, 20.4f, 20.8f)
        close()
    }
}
