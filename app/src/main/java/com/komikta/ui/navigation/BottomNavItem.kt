package com.komikta.ui.navigation

import androidx.compose.ui.graphics.vector.ImageVector

sealed class BottomNavItem(
    val route: String,
    val title: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
) {
    data object Home : BottomNavItem(
        route = "home",
        title = "Home",
        selectedIcon = NavIcons.home(true),
        unselectedIcon = NavIcons.home(false)
    )

    data object Explore : BottomNavItem(
        route = "explore",
        title = "Explore",
        selectedIcon = NavIcons.explore(true),
        unselectedIcon = NavIcons.explore(false)
    )

    data object Library : BottomNavItem(
        route = "library",
        title = "Library",
        selectedIcon = NavIcons.library(true),
        unselectedIcon = NavIcons.library(false)
    )

    data object Profile : BottomNavItem(
        route = "profile",
        title = "Profile",
        selectedIcon = NavIcons.profile(true),
        unselectedIcon = NavIcons.profile(false)
    )
}

val bottomNavItems = listOf(
    BottomNavItem.Home,
    BottomNavItem.Explore,
    BottomNavItem.Library,
    BottomNavItem.Profile
)
