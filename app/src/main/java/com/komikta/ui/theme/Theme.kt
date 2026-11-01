package com.komikta.ui.theme

import com.komikta.R
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp

private val Bg = Color(0xFF090909)
private val Surface = Color(0xFF141414)
private val Surface2 = Color(0xFF202020)
private val Primary = Color(0xFFF5F5F5)
private val Text1 = Color.White
private val Text2 = Color(0xFFB4BDC1)
private val Text3 = Color(0xFF797C81)

private val Scheme = darkColorScheme(
    primary = Primary,
    onPrimary = Color(0xFF0F1417),
    secondary = Color(0xFFB7D2DD),
    background = Bg,
    onBackground = Text1,
    surface = Surface,
    onSurface = Text1,
    surfaceVariant = Surface2,
    onSurfaceVariant = Text2,
    outline = Color(0xFF303030)
)

private val Poppins = FontFamily(
    Font(R.font.poppins_regular, FontWeight.Normal),
    Font(R.font.poppins_semibold, FontWeight.SemiBold),
    Font(R.font.poppins_semibold, FontWeight.Medium),
    Font(R.font.poppins_semibold, FontWeight.Bold)
)

private val Type = Typography(
    headlineLarge = TextStyle(fontFamily = Poppins, fontWeight = FontWeight.Bold, fontSize = 26.sp, color = Text1),
    headlineMedium = TextStyle(fontFamily = Poppins, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = Text1),
    titleLarge = TextStyle(fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Text1),
    titleMedium = TextStyle(fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = Text1),
    bodyLarge = TextStyle(fontFamily = Poppins, fontWeight = FontWeight.Normal, fontSize = 14.sp, color = Text1),
    bodyMedium = TextStyle(fontFamily = Poppins, fontWeight = FontWeight.Normal, fontSize = 13.sp, color = Text1),
    labelLarge = TextStyle(fontFamily = Poppins, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = Text2),
    labelMedium = TextStyle(fontFamily = Poppins, fontWeight = FontWeight.Medium, fontSize = 11.sp, color = Text2),
    labelSmall = TextStyle(fontFamily = Poppins, fontWeight = FontWeight.Medium, fontSize = 10.sp, color = Text3)
)

object Ui {
    val Bg = Color(0xFF090909)
    val Bar = Color(0xFF101010)
    val Card = Color(0xFF151515)
    val Chip = Color(0xFF222222)
    val Line = Color(0xFF2C2C2C)
    val Badge = Color(0xB3090909)
    val Text2 = Color(0xFFB7B7B7)
    val Text3 = Color(0xFF777777)
    val Accent = Color(0xFFF4F4F4)
    val AccentSoft = Color(0x1FFFFFFF)
    val OnAccent = Color(0xFF101010)
    val Star = Color(0xFFF0F0F0)
    val AccentBrush = Brush.linearGradient(listOf(Color(0xFFF5F5F5), Color(0xFFD8D8D8)))
    val Scrim = Brush.verticalGradient(listOf(Color.Transparent, Color(0xE6090909)))
}

@Composable
fun KomiktaTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, typography = Type, content = content)
}
