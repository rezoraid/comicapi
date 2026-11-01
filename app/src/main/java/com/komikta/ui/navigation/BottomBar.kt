package com.komikta.ui.navigation

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.komikta.ui.theme.Ui

@Composable
fun BottomBar(
    items: List<BottomNavItem>,
    selectedRoute: String?,
    onSelect: (String) -> Unit
) {
    Column(Modifier.fillMaxWidth().background(Ui.Bar)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(Ui.Line))
        Row(Modifier.fillMaxWidth().navigationBarsPadding().height(56.dp)) {
            items.forEach { item ->
                val selected = item.route == selectedRoute
                val tint by animateColorAsState(if (selected) Ui.Accent else Ui.Text3, tween(150), label = "navTint")
                Column(
                    Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .clickable { onSelect(item.route) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Icon(
                        imageVector = if (selected) item.selectedIcon else item.unselectedIcon,
                        contentDescription = item.title,
                        tint = tint,
                        modifier = Modifier.size(24.dp)
                    )
                    Text(item.title, fontSize = 10.sp, color = tint, maxLines = 1, modifier = Modifier.padding(top = 1.dp))
                }
            }
        }
    }
}
