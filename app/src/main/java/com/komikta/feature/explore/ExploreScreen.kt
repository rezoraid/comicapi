package com.komikta.feature.explore

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.komikta.ui.components.AppIcons
import com.komikta.ui.components.Chip
import com.komikta.ui.components.ComicCard
import com.komikta.ui.components.PosterRowSkeleton
import com.komikta.ui.theme.Ui
import kotlinx.coroutines.delay
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue

private val Types = listOf("All", "Manhwa", "Manhua", "Manga")

@Composable
fun ExploreScreen(
    onComicClick: (source: String, slug: String) -> Unit,
    focusSearch: Boolean,
    onSearchFocused: () -> Unit,
    viewModel: ExploreViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val searchFocus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(focusSearch) {
        if (focusSearch) {
            delay(150)
            runCatching { searchFocus.requestFocus() }
            keyboard?.show()
            onSearchFocused()
        }
    }
    var showFilter by remember { mutableStateOf(false) }
    val gridState = rememberLazyGridState()

    val shouldLoadMore by remember {
        derivedStateOf {
            val info = gridState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= info.totalItemsCount - 6
        }
    }
    LaunchedEffect(shouldLoadMore) {
        if (shouldLoadMore) viewModel.loadMore()
    }

    Column(Modifier.fillMaxSize().background(Ui.Bg)) {
        val activeCount = uiState.selectedGenres.size + listOf(uiState.sort, uiState.status).count { it != null }
        SearchField(
            value = uiState.query,
            onChange = viewModel::onQueryChange,
            focus = searchFocus,
            filterActive = activeCount > 0,
            onFilterClick = { showFilter = true }
        )

        Row(
            Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Types.forEach { type ->
                val value = if (type == "All") null else type.lowercase()
                Chip(type, uiState.type == value, { viewModel.setType(value) })
            }
        }

        Spacer(Modifier.height(8.dp))

        val quickGenres = remember(uiState.selectedGenres, uiState.genres) {
            (uiState.selectedGenres + uiState.genres.take(6)).toList()
        }
        Row(
            Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            quickGenres.forEach { genre ->
                val on = genre in uiState.selectedGenres
                Chip(
                    text = genre,
                    selected = on,
                    onClick = {
                        viewModel.applyFilters(
                            if (on) uiState.selectedGenres - genre else uiState.selectedGenres + genre,
                            uiState.sort,
                            uiState.status
                        )
                    }
                )
            }
        }

        Spacer(Modifier.height(8.dp))

        when {
            uiState.isLoading && uiState.comics.isEmpty() -> PosterRowSkeleton(rows = 4)
            uiState.errorMessage != null && uiState.comics.isEmpty() -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(uiState.errorMessage ?: "Error", color = Ui.Text2)
                }
            }
            else -> {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    state = gridState,
                    contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 4.dp, bottom = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    modifier = Modifier.fillMaxSize()
                ) {
                    items(uiState.comics, key = { "${it.source}:${it.slug}" }, contentType = { "comic" }) { comic ->
                        ComicCard(comic, { onComicClick(comic.source, comic.slug) })
                    }
                    if (uiState.isLoadingMore) {
                        item(span = { GridItemSpan(maxLineSpan) }, contentType = "loading") {
                            Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = Ui.Accent, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                            }
                        }
                    }
                }
            }
        }
    }

    if (showFilter) {
        GenreFilterSheet(
            genres = uiState.genres,
            selected = uiState.selectedGenres,
            sort = uiState.sort,
            status = uiState.status,
            onApply = { genres, sort, status ->
                viewModel.applyFilters(genres, sort, status)
                showFilter = false
            },
            onDismiss = { showFilter = false }
        )
    }
}

@Composable
private fun SearchField(
    value: String,
    onChange: (String) -> Unit,
    focus: FocusRequester,
    filterActive: Boolean,
    onFilterClick: () -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            Modifier
                .weight(1f)
                .height(44.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Ui.Card)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(AppIcons.search, null, tint = Ui.Text2, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) {
                    Text("Cari manga, manhwa, manhua", color = Ui.Text3, fontSize = 14.sp, maxLines = 1)
                }
                BasicTextField(
                    value = value,
                    onValueChange = onChange,
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyLarge,
                    cursorBrush = SolidColor(Ui.Accent),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus)
                )
            }
            if (value.isNotEmpty()) {
                IconButton(onClick = { onChange("") }, modifier = Modifier.size(28.dp)) {
                    Icon(AppIcons.close, "Hapus pencarian", tint = Ui.Text3, modifier = Modifier.size(17.dp))
                }
            }
        }
        Box(
            Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(if (filterActive) Ui.Accent else Ui.Card)
                .clickable(onClick = onFilterClick),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                AppIcons.filter,
                "Filter",
                tint = if (filterActive) Ui.OnAccent else Color.White,
                modifier = Modifier.size(22.dp)
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun GenreFilterSheet(
    genres: List<String>,
    selected: Set<String>,
    sort: String?,
    status: String?,
    onApply: (Set<String>, String?, String?) -> Unit,
    onDismiss: () -> Unit
) {
    var draft by remember { mutableStateOf(selected) }
    var draftSort by remember { mutableStateOf(sort) }
    var draftStatus by remember { mutableStateOf(status) }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Ui.Card,
        contentColor = Color.White
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 16.dp)
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Filter komik", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                IconButton(onClick = onDismiss) {
                    Icon(AppIcons.close, "Close", tint = Color.White)
                }
            }

            Column(
                Modifier
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState())
            ) {
                SheetLabel("Urutkan")
                OptionRow(
                    options = listOf("Terbaru" to "latest", "Populer" to "popular", "Rating" to "rating", "A-Z" to "az"),
                    selected = draftSort,
                    onSelect = { draftSort = if (draftSort == it) null else it }
                )
                SheetLabel("Status")
                OptionRow(
                    options = listOf("Ongoing" to "ongoing", "Completed" to "completed", "Hiatus" to "hiatus"),
                    selected = draftStatus,
                    onSelect = { draftStatus = if (draftStatus == it) null else it }
                )
                SheetLabel("Genre (pilih satu atau lebih)")
                if (genres.isEmpty()) {
                    Text("Memuat...", color = Ui.Text2, modifier = Modifier.padding(vertical = 12.dp))
                } else {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        genres.forEach { genre ->
                            val isSelected = genre in draft
                            Chip(
                                text = genre,
                                selected = isSelected,
                                onClick = { draft = if (isSelected) draft - genre else draft + genre }
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Row(
                Modifier.fillMaxWidth().padding(bottom = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Button(
                    onClick = {
                        draft = emptySet()
                        draftSort = null
                        draftStatus = null
                    },
                    modifier = Modifier.weight(1f).height(48.dp),
                    shape = RoundedCornerShape(8.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Ui.Chip, contentColor = Color.White)
                ) { Text("Reset", fontWeight = FontWeight.SemiBold) }
                Button(
                    onClick = { onApply(draft, draftSort, draftStatus) },
                    modifier = Modifier.weight(1f).height(48.dp),
                    shape = RoundedCornerShape(8.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Ui.Accent, contentColor = Ui.OnAccent)
                ) { Text("Terapkan", fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}

@Composable
private fun SheetLabel(text: String) {
    Text(text, color = Ui.Text2, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp, bottom = 8.dp))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun OptionRow(
    options: List<Pair<String, String>>,
    selected: String?,
    onSelect: (String) -> Unit
) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        options.forEach { (label, value) ->
            Chip(label, selected == value, { onSelect(value) })
        }
    }
}
