package com.komikta.ui.components

import androidx.compose.ui.graphics.vector.ImageVector
import com.komikta.ui.navigation.circle
import com.komikta.ui.navigation.navIcon

object AppIcons {
    val chevronLeft: ImageVector by lazy {
        navIcon("ChevronLeft", false, strokeWidth = 2.4f) {
            moveTo(15f, 5f); lineTo(8f, 12f); lineTo(15f, 19f)
        }
    }

    val chevronRight: ImageVector by lazy {
        navIcon("ChevronRight", false, strokeWidth = 2.4f) {
            moveTo(9f, 5f); lineTo(16f, 12f); lineTo(9f, 19f)
        }
    }

    val chevronsDown: ImageVector by lazy {
        navIcon("ChevronsDown", false, strokeWidth = 2.2f) {
            moveTo(6.5f, 6.5f); lineTo(12f, 12f); lineTo(17.5f, 6.5f)
            moveTo(6.5f, 12.5f); lineTo(12f, 18f); lineTo(17.5f, 12.5f)
        }
    }

    val close: ImageVector by lazy {
        navIcon("Close", false, strokeWidth = 2.2f) {
            moveTo(6f, 6f); lineTo(18f, 18f)
            moveTo(18f, 6f); lineTo(6f, 18f)
        }
    }

    val sort: ImageVector by lazy {
        navIcon("Sort", false, strokeWidth = 2f) {
            moveTo(7f, 4f); lineTo(7f, 20f)
            moveTo(3.5f, 7.5f); lineTo(7f, 4f); lineTo(10.5f, 7.5f)
            moveTo(17f, 20f); lineTo(17f, 4f)
            moveTo(13.5f, 16.5f); lineTo(17f, 20f); lineTo(20.5f, 16.5f)
        }
    }

    val filter: ImageVector by lazy {
        navIcon("Filter", false, strokeWidth = 2.2f) {
            moveTo(4f, 7f); lineTo(20f, 7f)
            moveTo(7f, 12f); lineTo(17f, 12f)
            moveTo(10f, 17f); lineTo(14f, 17f)
        }
    }

    val edit: ImageVector by lazy {
        navIcon("Edit", false, strokeWidth = 2f) {
            moveTo(4f, 16.5f); lineTo(3.5f, 20.5f); lineTo(7.5f, 20f)
            moveTo(5f, 19f); lineTo(16.8f, 7.2f)
            moveTo(14.8f, 5.2f); lineTo(16.8f, 3.2f); lineTo(20.8f, 7.2f); lineTo(18.8f, 9.2f)
        }
    }

    val search: ImageVector by lazy {
        navIcon("Search", false) {
            circle(10.5f, 10.5f, 6.5f)
            moveTo(15.4f, 15.4f); lineTo(20f, 20f)
        }
    }

    val checkCircle: ImageVector by lazy {
        navIcon("CheckCircle", false, strokeWidth = 1.6f) {
            circle(12f, 12f, 9f)
            moveTo(8f, 12.4f); lineTo(10.8f, 15.2f); lineTo(16.2f, 9.2f)
        }
    }

    fun bookmark(filled: Boolean): ImageVector = if (filled) bookmarkFilled else bookmarkOutline

    private val bookmarkOutline: ImageVector by lazy { buildBookmark(false) }
    private val bookmarkFilled: ImageVector by lazy { buildBookmark(true) }

    private fun buildBookmark(filled: Boolean) = navIcon("Bookmark", filled) {
        moveTo(6.5f, 4.8f)
        curveTo(6.5f, 4.1f, 7f, 3.6f, 7.7f, 3.6f)
        lineTo(16.3f, 3.6f)
        curveTo(17f, 3.6f, 17.5f, 4.1f, 17.5f, 4.8f)
        lineTo(17.5f, 20.4f)
        lineTo(12f, 16.2f)
        lineTo(6.5f, 20.4f)
        close()
    }

    val comment: ImageVector by lazy {
        navIcon("Comment", false, strokeWidth = 1.8f) {
            moveTo(4f, 5.5f); lineTo(20f, 5.5f); lineTo(20f, 16.2f); lineTo(10.2f, 16.2f)
            lineTo(5.8f, 19.8f); lineTo(5.8f, 16.2f); lineTo(4f, 16.2f); close()
        }
    }

    val more: ImageVector by lazy {
        navIcon("More", true, stroked = false) {
            circle(5f, 12f, 1.7f); circle(12f, 12f, 1.7f); circle(19f, 12f, 1.7f)
        }
    }

    val send: ImageVector by lazy {
        navIcon("Send", false, strokeWidth = 1.8f) {
            moveTo(4f, 11.6f); lineTo(20f, 4.4f); lineTo(14f, 20f); lineTo(11.4f, 13.2f); close()
            moveTo(11.4f, 13.2f); lineTo(20f, 4.4f)
        }
    }

    fun heart(filled: Boolean): ImageVector = if (filled) heartFilled else heartOutline

    private val heartOutline: ImageVector by lazy { buildHeart(false) }
    private val heartFilled: ImageVector by lazy { buildHeart(true) }

    private fun buildHeart(filled: Boolean) = navIcon("Heart", filled, strokeWidth = 1.8f) {
        moveTo(12f, 20.2f)
        curveTo(5.5f, 15.2f, 3.4f, 11.8f, 3.4f, 8.9f)
        curveTo(3.4f, 6.5f, 5.2f, 4.8f, 7.4f, 4.8f)
        curveTo(9.2f, 4.8f, 10.9f, 5.8f, 12f, 7.6f)
        curveTo(13.1f, 5.8f, 14.8f, 4.8f, 16.6f, 4.8f)
        curveTo(18.8f, 4.8f, 20.6f, 6.5f, 20.6f, 8.9f)
        curveTo(20.6f, 11.8f, 18.5f, 15.2f, 12f, 20.2f)
        close()
    }
}
