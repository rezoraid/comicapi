package com.komikta.feature.reader

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.runtime.withFrameNanos
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import android.app.Activity
import android.os.Build
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.ui.text.font.FontWeight
import com.komikta.domain.model.Chapter
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.material3.SliderDefaults
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import coil.imageLoader
import coil.size.Dimension
import coil.size.Size
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.layout.aspectRatio
import coil.request.CachePolicy
import coil.request.ImageRequest
import com.komikta.domain.model.ChapterContent
import com.komikta.ui.theme.Ui
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import android.graphics.BitmapFactory
import android.graphics.drawable.ColorDrawable
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import coil.ImageLoader
import coil.decode.DecodeResult
import coil.decode.Decoder
import coil.fetch.SourceResult
import coil.memory.MemoryCache
import coil.request.Options
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.flow.collectLatest
import coil.request.SuccessResult
import coil.size.Scale
import kotlinx.coroutines.Dispatchers
import kotlin.math.abs
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue

private const val PRELOAD_AHEAD = 4

enum class ScrollMode { Smooth, Swipe }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReaderScreen(
    onBack: () -> Unit,
    onComments: (chapterSlug: String) -> Unit = {},
    viewModel: ReaderViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val autoNext by viewModel.autoNext.collectAsStateWithLifecycle()
    val readSlugs by viewModel.readSlugs.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    var controlsVisible by remember { mutableStateOf(true) }
    var showSettings by remember { mutableStateOf(false) }
    var showChapters by remember { mutableStateOf(false) }
    var autoScroll by remember { mutableStateOf(false) }
    var scrollSpeed by remember { mutableFloatStateOf(1f) }
    var scrollMode by remember { mutableStateOf(ScrollMode.Smooth) }

    var interactTick by remember { mutableIntStateOf(0) }

    // Auto hide controls (timer di-reset tiap kali slider disentuh)
    LaunchedEffect(controlsVisible, interactTick) {
        if (controlsVisible) {
            delay(3500)
            controlsVisible = false
        }
    }

    val density = LocalDensity.current

    val context = LocalContext.current

    // Fullscreen immersive: sembunyikan status bar + nav bar, konten sampai ke area poni/cutout
    val view = LocalView.current
    DisposableEffect(Unit) {
        val window = (view.context as? Activity)?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        if (window != null && controller != null) {
            WindowCompat.setDecorFitsSystemWindows(window, false)
            if (Build.VERSION.SDK_INT >= 28) {
                window.attributes = window.attributes.apply {
                    layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                }
            }
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        }
        onDispose {
            if (window != null && controller != null) {
                controller.show(WindowInsetsCompat.Type.systemBars())
                if (Build.VERSION.SDK_INT >= 28) {
                    window.attributes = window.attributes.apply {
                        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT
                    }
                }
            }
        }
    }
    val screenWidthPx = with(density) { LocalConfiguration.current.screenWidthDp.dp.roundToPx() }
    val readerItems = remember(uiState.loaded) { buildReaderItems(uiState.loaded) }
    val ratios = remember { HashMap<String, Float>() }
    val firstSlug = uiState.loaded.firstOrNull()?.chapterSlug

    // Progress halaman untuk chapter yang sedang dibaca
    val currentSlug = uiState.content?.chapterSlug
    val pageIndexes = remember(readerItems, currentSlug) {
        readerItems.withIndex()
            .filter { it.value is ReaderItem.Page && it.value.chapterSlug == currentSlug }
            .map { it.index }
    }
    val firstPageIndex = pageIndexes.firstOrNull() ?: 0
    val totalPages = pageIndexes.size
    val currentPage by remember(firstPageIndex, totalPages) {
        derivedStateOf {
            (listState.firstVisibleItemIndex - firstPageIndex + 1).coerceIn(1, totalPages.coerceAtLeast(1))
        }
    }

    // Satu state turunan: hanya memicu ulang saat index terakhir yang terlihat berubah (bukan tiap frame scroll)
    val lastVisible by remember { derivedStateOf { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1 } }

    LaunchedEffect(firstSlug) { if (firstSlug != null) listState.scrollToItem(0) }

    LaunchedEffect(readerItems) {
        snapshotFlow { readerItems.getOrNull(listState.firstVisibleItemIndex)?.chapterSlug }
            .filterNotNull()
            .distinctUntilChanged()
            .collect { viewModel.setCurrent(it) }
    }

    LaunchedEffect(readerItems) {
        val requested = HashSet<String>()
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1 }
            .distinctUntilChanged()
            .collectLatest { last ->
                if (last < 0) return@collectLatest
                val end = minOf(readerItems.lastIndex, last + PRELOAD_AHEAD)
                for (i in last + 1..end) {
                    val page = readerItems[i] as? ReaderItem.Page ?: continue
                    if (page.url in ratios || !requested.add(page.url)) continue
                    fetchToDisk(context, page.url, ratios)
                }
            }
    }

    LaunchedEffect(readerItems, autoNext) {
        if (!autoNext) return@LaunchedEffect
        snapshotFlow { lastVisible }.collect { last ->
            if (last >= 0 && last >= readerItems.size - 6) viewModel.appendNext()
        }
    }

    // Sambung chapter berikutnya saat scroll berhenti sejenak, bukan di tengah scroll dekat akhir chapter
    val onLastLoaded = currentSlug != null && currentSlug == uiState.loaded.lastOrNull()?.chapterSlug
    LaunchedEffect(autoNext, onLastLoaded, uiState.upcoming?.chapterSlug) {
        if (!autoNext || !onLastLoaded || uiState.upcoming == null) return@LaunchedEffect
        snapshotFlow { listState.isScrollInProgress }.collectLatest { scrolling ->
            if (!scrolling) {
                delay(350)
                viewModel.appendNext()
            }
        }
    }

    val nearEnd by remember(totalPages) { derivedStateOf { totalPages > 0 && currentPage >= totalPages - 8 } }
    LaunchedEffect(uiState.upcoming?.chapterSlug, autoNext, nearEnd) {
        if (autoNext || !nearEnd) return@LaunchedEffect
        uiState.upcoming?.imageUrls?.take(3)?.forEach { fetchToDisk(context, it, ratios) }
    }

    LaunchedEffect(autoScroll, scrollMode, scrollSpeed) {
        if (!autoScroll) return@LaunchedEffect
        if (scrollMode == ScrollMode.Smooth) {
            val pxPerSecond = with(density) { 70.dp.toPx() } * scrollSpeed
            var last = 0L
            while (autoScroll) {
                val dt = withFrameNanos { now ->
                    val d = if (last == 0L) 0L else now - last
                    last = now
                    d
                }
                listState.scrollBy(pxPerSecond * dt / 1_000_000_000f)
                if (!listState.canScrollForward) autoScroll = false
            }
        } else {
            while (autoScroll) {
                delay((2200 / scrollSpeed).toLong().coerceAtLeast(500))
                val distance = listState.layoutInfo.viewportSize.height * 0.7f
                listState.animateScrollBy(
                    distance,
                    tween(durationMillis = 650, easing = FastOutSlowInEasing)
                )
                if (!listState.canScrollForward) autoScroll = false
            }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .pointerInput(Unit) { detectTapGestures { controlsVisible = !controlsVisible } }
    ) {
        when {
            uiState.isLoading -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Ui.Accent)
                }
            }
            uiState.errorMessage != null -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(uiState.errorMessage ?: "Error", color = Color.White)
                        Spacer(Modifier.height(8.dp))
                        TextButton(onClick = { viewModel.loadChapter() }) { Text("Retry") }
                    }
                }
            }
            uiState.content != null -> {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize()
                ) {
                    items(readerItems, key = { it.key }, contentType = { if (it is ReaderItem.Page) 0 else 1 }) { item ->
                        when (item) {
                            is ReaderItem.Page -> PageImage(item.url, screenWidthPx, ratios)
                            is ReaderItem.Divider -> {
                                val info = uiState.chapterInfo
                                val nextSlug = uiState.loaded.firstOrNull { it.chapterSlug == item.chapterSlug }?.nextChapterSlug
                                ChapterCommentsSection(item.chapterSlug, viewModel::commentPreview) { onComments(item.chapterSlug) }
                                ChapterEnd(
                                    current = info[item.chapterSlug],
                                    fallbackTitle = uiState.loaded.firstOrNull { it.chapterSlug == item.chapterSlug }?.title,
                                    nextSlug = nextSlug,
                                    next = nextSlug?.let { info[it] },
                                    onNext = null,
                                    compact = true,
                                    onComments = { onComments(item.chapterSlug) }
                                )
                            }
                            is ReaderItem.End -> {
                                val chapter = uiState.loaded.firstOrNull { it.chapterSlug == item.chapterSlug }
                                val nextSlug = chapter?.nextChapterSlug
                                ChapterCommentsSection(item.chapterSlug, viewModel::commentPreview) { onComments(item.chapterSlug) }
                                if (autoNext) {
                                    val info = uiState.chapterInfo
                                    ChapterEnd(
                                        current = info[item.chapterSlug],
                                        fallbackTitle = chapter?.title,
                                        nextSlug = nextSlug,
                                        next = nextSlug?.let { info[it] },
                                        onNext = { viewModel.appendNext() },
                                        onComments = { onComments(item.chapterSlug) }
                                    )
                                } else {
                                    ChapterNav(
                                        hasPrev = !chapter?.prevChapterSlug.isNullOrBlank(),
                                        hasNext = !nextSlug.isNullOrBlank(),
                                        onPrev = { viewModel.goPrev() },
                                        onNext = { viewModel.goNext() },
                                        onDetail = onBack,
                                        onComments = { onComments(item.chapterSlug) }
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        if (controlsVisible) {
            Column(
                Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth()
                    .background(Ui.Bar)
                    .windowInsetsPadding(WindowInsets.statusBars.union(WindowInsets.displayCutout).only(WindowInsetsSides.Top))
            ) {
                Row(
                    Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Color.White)
                    }
                    Text(
                        text = uiState.content?.title ?: "Reader",
                        color = Color.White,
                        style = MaterialTheme.typography.titleSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f).padding(horizontal = 8.dp)
                    )
                    IconButton(onClick = { showChapters = true }) {
                        Icon(Icons.Default.Menu, "Daftar chapter", tint = Color.White)
                    }
                }
            }

            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .background(Ui.Bar)
                    .navigationBarsPadding()
            ) {
                if (totalPages > 1) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("$currentPage", color = Color.White, style = MaterialTheme.typography.labelMedium)
                        Slider(
                            value = currentPage.toFloat(),
                            onValueChange = { v ->
                                interactTick++
                                val page = v.toInt().coerceIn(1, totalPages)
                                scope.launch { listState.scrollToItem(firstPageIndex + page - 1) }
                            },
                            valueRange = 1f..totalPages.toFloat(),
                            colors = SliderDefaults.colors(
                                thumbColor = Ui.Accent,
                                activeTrackColor = Ui.Accent,
                                inactiveTrackColor = Color.White.copy(alpha = 0.2f)
                            ),
                            modifier = Modifier.weight(1f).padding(horizontal = 8.dp)
                        )
                        Text("$totalPages", color = Ui.Text2, style = MaterialTheme.typography.labelMedium)
                    }
                }
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val hasPrev = !uiState.content?.prevChapterSlug.isNullOrBlank()
                    val hasNext = !uiState.content?.nextChapterSlug.isNullOrBlank()
                    IconButton(onClick = { viewModel.goPrev() }, enabled = hasPrev) {
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Prev", tint = if (hasPrev) Color.White else Ui.Text3)
                    }
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Default.Settings, "Settings", tint = Color.White)
                    }
                    IconButton(
                        onClick = { autoScroll = !autoScroll },
                        modifier = Modifier.clip(CircleShape).background(if (autoScroll) Ui.AccentSoft else Color.Transparent)
                    ) {
                        Icon(Icons.Default.PlayArrow, if (autoScroll) "Pause" else "Auto scroll", tint = if (autoScroll) Ui.Accent else Color.White)
                    }
                    IconButton(onClick = { viewModel.goNext() }, enabled = hasNext) {
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, "Next", tint = if (hasNext) Color.White else Ui.Text3)
                    }
                }
            }
        }

        // Daftar chapter
        if (showChapters) {
            ChapterListSheet(
                chapters = uiState.chapterInfo.values.toList(),
                currentSlug = uiState.content?.chapterSlug,
                readSlugs = readSlugs,
                onSelect = { slug ->
                    showChapters = false
                    if (slug != uiState.content?.chapterSlug) viewModel.loadChapter(slug)
                },
                onDismiss = { showChapters = false }
            )
        }

        // Settings sheet
        if (showSettings) {
            ModalBottomSheet(
                onDismissRequest = { showSettings = false },
                sheetState = rememberModalBottomSheetState(),
                containerColor = Color(0xFF151D20)
            ) {
                Column(Modifier.padding(20.dp)) {
                    Text(
                        "Reading Settings",
                        style = MaterialTheme.typography.titleMedium,
                        color = Color.White
                    )
                    Spacer(Modifier.height(20.dp))

                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text("Auto Scroll", color = Color.White)
                            Text(
                                "Scroll otomatis seperti tangan",
                                style = MaterialTheme.typography.labelSmall,
                                color = Color(0xFFBDBDBD)
                            )
                        }
                        Switch(
                            checked = autoScroll,
                            onCheckedChange = { autoScroll = it }
                        )
                    }

                    Spacer(Modifier.height(16.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("Auto Next Chapter", color = Color.White)
                            Text(
                                "Lanjut otomatis di akhir chapter",
                                style = MaterialTheme.typography.labelSmall,
                                color = Color(0xFFBDBDBD)
                            )
                        }
                        Switch(checked = autoNext, onCheckedChange = { viewModel.setAutoNext(it) })
                    }

                    Spacer(Modifier.height(16.dp))
                    Text("Mode", color = Color.White)
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ScrollModeOption(
                            title = "Halus",
                            subtitle = "Mengalir pelan",
                            selected = scrollMode == ScrollMode.Smooth,
                            modifier = Modifier.weight(1f),
                            onClick = { scrollMode = ScrollMode.Smooth }
                        )
                        ScrollModeOption(
                            title = "Geser",
                            subtitle = "Seperti tangan",
                            selected = scrollMode == ScrollMode.Swipe,
                            modifier = Modifier.weight(1f),
                            onClick = { scrollMode = ScrollMode.Swipe }
                        )
                    }

                    Spacer(Modifier.height(16.dp))
                    Text("Kecepatan: ${"%.1f".format(scrollSpeed)}x", color = Color.White)
                    Slider(
                        value = scrollSpeed,
                        onValueChange = { scrollSpeed = it },
                        valueRange = 0.5f..2.5f,
                        steps = 3
                    )
                    Spacer(Modifier.height(24.dp))
                }
            }
        }
    }
}

sealed interface ReaderItem {
    val key: String
    val chapterSlug: String
    data class Page(override val chapterSlug: String, val index: Int, val url: String) : ReaderItem {
        override val key: String = "$chapterSlug:$index"
    }
    data class Divider(override val chapterSlug: String) : ReaderItem {
        override val key: String = "divider:$chapterSlug"
    }
    data class End(override val chapterSlug: String) : ReaderItem {
        override val key: String = "end:$chapterSlug"
    }
}

private fun buildReaderItems(chapters: List<ChapterContent>): List<ReaderItem> = buildList {
    chapters.forEachIndexed { i, c ->
        c.imageUrls.forEachIndexed { idx, url -> add(ReaderItem.Page(c.chapterSlug, idx, url)) }
        add(if (i < chapters.lastIndex) ReaderItem.Divider(c.chapterSlug) else ReaderItem.End(c.chapterSlug))
    }
}

private fun pageKey(url: String, widthPx: Int) = "$url@$widthPx"

private fun pageRequest(context: android.content.Context, url: String, widthPx: Int) =
    ImageRequest.Builder(context)
        .data(url)
        .size(Size(widthPx, Dimension.Undefined))
        .scale(Scale.FIT)
        .diskCacheKey(url)
        .memoryCacheKey(pageKey(url, widthPx))
        .crossfade(false)
        .build()

/**
 * Hanya mengunduh ke disk cache (untuk chapter berikutnya). Ukuran sangat kecil -> decode hampir gratis,
 * tapi file aslinya tetap tersimpan, jadi tidak ada lonjakan CPU saat sedang membaca.
 */
private fun diskPrefetchRequest(context: android.content.Context, url: String) =
    ImageRequest.Builder(context)
        .data(url)
        .size(Size(16, 16))
        .decoderFactory(BoundsDecoder.Factory())
        .diskCacheKey(url)
        .memoryCachePolicy(CachePolicy.DISABLED)
        .crossfade(false)
        .build()

private suspend fun fetchToDisk(context: android.content.Context, url: String, ratios: MutableMap<String, Float>) {
    val res = context.imageLoader.execute(diskPrefetchRequest(context, url)) as? SuccessResult ?: return
    val d = res.drawable
    if (d.intrinsicWidth > 0 && d.intrinsicHeight > 0) ratios[url] = d.intrinsicWidth.toFloat() / d.intrinsicHeight
}

/** Hanya baca ukuran gambar (tanpa decode piksel) -> prefetch ke disk hampir tanpa beban CPU. */
private class BoundsDrawable(private val w: Int, private val h: Int) : ColorDrawable(0) {
    override fun getIntrinsicWidth() = w
    override fun getIntrinsicHeight() = h
}

private class BoundsDecoder(private val result: SourceResult) : Decoder {
    override suspend fun decode(): DecodeResult {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        runInterruptible(Dispatchers.IO) {
            result.source.source().use { BitmapFactory.decodeStream(it.inputStream(), null, o) }
        }
        return DecodeResult(BoundsDrawable(o.outWidth, o.outHeight), false)
    }

    class Factory : Decoder.Factory {
        override fun create(result: SourceResult, options: Options, imageLoader: ImageLoader): Decoder =
            BoundsDecoder(result)
    }
}

@Composable
private fun PageImage(url: String, widthPx: Int, ratios: MutableMap<String, Float>) {
    val context = LocalContext.current
    val cached = remember(url, widthPx) {
        context.imageLoader.memoryCache?.get(MemoryCache.Key(pageKey(url, widthPx)))?.bitmap
    }
    if (cached != null && cached.width > 0 && cached.height > 0) {
        val image = remember(cached) { cached.asImageBitmap() }
        Image(
            bitmap = image,
            contentDescription = null,
            contentScale = ContentScale.FillWidth,
            modifier = Modifier.fillMaxWidth().aspectRatio(cached.width.toFloat() / cached.height)
        )
        return
    }
    var retry by remember(url) { mutableIntStateOf(0) }
    var failed by remember(url) { mutableStateOf(false) }
    var ratio by remember(url) { mutableFloatStateOf(ratios[url] ?: 0.7f) }
    val request = remember(url, widthPx, retry) { pageRequest(context, url, widthPx) }
    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(ratio)
            .background(Color(0xFF0E0E0E)),
        contentAlignment = Alignment.Center
    ) {
        AsyncImage(
            model = request,
            contentDescription = null,
            contentScale = ContentScale.FillWidth,
            modifier = Modifier.fillMaxSize(),
            onSuccess = { st ->
                val d = st.painter.intrinsicSize
                if (d.width > 0f && d.height > 0f) {
                    val r = d.width / d.height
                    ratios[url] = r
                    if (abs(ratio - r) > 0.003f) ratio = r
                }
                failed = false
            },
            onError = { failed = true }
        )
        if (failed) {
            Text(
                "Gagal memuat. Ketuk untuk ulangi",
                style = MaterialTheme.typography.labelMedium,
                color = Color(0xFF8A8A8A),
                modifier = Modifier.clickable { failed = false; retry++ }.padding(16.dp)
            )
        }
    }
}

@Composable
private fun ScrollModeOption(
    title: String,
    subtitle: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Column(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) Ui.Accent else Color(0xFF1C262A))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 10.dp)
    ) {
        Text(title, color = if (selected) Ui.OnAccent else Color.White, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
        Text(subtitle, color = if (selected) Color(0xFF2B3A40) else Color(0xFF999999), style = MaterialTheme.typography.labelSmall)
    }
}

private fun chapterLabel(c: Chapter): String =
    c.title?.takeIf { it.isNotBlank() }
        ?: c.number?.takeIf { it.isNotBlank() }?.let { "Chapter $it" }
        ?: c.slug

private fun chapterNumber(c: Chapter): Double? =
    Regex("""\d+(\.\d+)?""").find(c.number ?: c.title ?: "")?.value?.toDoubleOrNull()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChapterListSheet(
    chapters: List<Chapter>,
    currentSlug: String?,
    readSlugs: Set<String>,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit
) {
    var query by remember { mutableStateOf("") }
    var oldestFirst by remember { mutableStateOf(false) }
    // Default chapter terbaru; pembaca bisa membalik urutan dengan satu ketukan.
    val sorted = remember(chapters, oldestFirst) {
        if (chapters.isNotEmpty() && chapters.all { chapterNumber(it) != null }) {
            if (oldestFirst) chapters.sortedBy { chapterNumber(it) } else chapters.sortedByDescending { chapterNumber(it) }
        } else if (oldestFirst) chapters.reversed() else chapters
    }
    val filtered = remember(sorted, query) {
        val q = query.trim()
        if (q.isEmpty()) sorted else sorted.filter { chapterLabel(it).contains(q, ignoreCase = true) }
    }
    val startIndex = remember(sorted, currentSlug) {
        (sorted.indexOfFirst { it.slug == currentSlug } - 2).coerceAtLeast(0)
    }
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = startIndex)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Color(0xFF1C1C1E),
        contentColor = Color.White
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.85f)
                .padding(horizontal = 16.dp)
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Chapters",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White,
                        modifier = Modifier.padding(start = 4.dp)
                    )
                    TextButton(onClick = { oldestFirst = !oldestFirst }) {
                        Icon(com.komikta.ui.components.AppIcons.chevronsDown, contentDescription = "Ubah urutan chapter", tint = Ui.Accent, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(if (oldestFirst) "Terlama" else "Terbaru", color = Ui.Accent, fontSize = 12.sp)
                    }
                }
                IconButton(
                    onClick = onDismiss,
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .border(1.dp, Color(0xFF48484A), CircleShape)
                ) {
                    Icon(Icons.Default.Close, "Tutup", tint = Color.White, modifier = Modifier.size(22.dp))
                }
            }

            Spacer(Modifier.height(14.dp))

            TextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                placeholder = { Text("Cari chapter...", color = Color(0xFF8E8E93)) },
                shape = RoundedCornerShape(26.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color(0xFF2C2C2E),
                    unfocusedContainerColor = Color(0xFF2C2C2E),
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    cursorColor = Ui.Accent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent
                ),
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(Modifier.height(8.dp))

            if (sorted.isEmpty()) {
                Box(Modifier.fillMaxWidth().padding(top = 32.dp), contentAlignment = Alignment.TopCenter) {
                    Text("Memuat daftar chapter...", color = Color(0xFF8E8E93))
                }
            } else if (filtered.isEmpty()) {
                Box(Modifier.fillMaxWidth().padding(top = 32.dp), contentAlignment = Alignment.TopCenter) {
                    Text("Chapter tidak ditemukan", color = Color(0xFF8E8E93))
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    items(filtered, key = { it.slug }) { chapter ->
                        val isCurrent = chapter.slug == currentSlug
                        val isRead = chapter.slug in readSlugs
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(16.dp))
                                .background(if (isCurrent) Color(0xFF2C2C2E) else Color.Transparent)
                                .clickable { onSelect(chapter.slug) }
                                .padding(horizontal = 14.dp, vertical = 16.dp)
                        ) {
                            Text(
                                text = chapterLabel(chapter),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = if (isCurrent) FontWeight.SemiBold else FontWeight.Normal,
                                color = when {
                                    isCurrent -> Color.White
                                    isRead -> Color(0xFF8E8E93)
                                    else -> Color.White
                                },
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                    item { Spacer(Modifier.height(24.dp)) }
                }
            }
        }
    }
}
