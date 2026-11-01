package com.komikta.domain.model

import com.komikta.data.remote.dto.ChapterSummaryDto
import com.komikta.data.remote.dto.ComicListItemDto
import com.komikta.data.remote.dto.toDomain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MapperTest {

    @Test
    fun `ComicListItemDto maps correctly to domain Comic`() {
        val dto = ComicListItemDto(
            title = "Test Comic",
            slug = "test-comic",
            cover = "https://example.com/cover.webp",
            type = "manhwa",
            status = "ongoing",
            rating = 9.5,
            chapterCount = 42,
            genres = listOf("Action", "Fantasy")
        )

        val comic = dto.toDomain(source = "lumos")

        assertEquals("Test Comic", comic.title)
        assertEquals("test-comic", comic.slug)
        assertEquals("https://example.com/cover.webp", comic.coverUrl)
        assertEquals("manhwa", comic.type)
        assertEquals("ongoing", comic.status)
        assertEquals(9.5, comic.rating)
        assertEquals(42, comic.chapterCount)
        assertEquals(listOf("Action", "Fantasy"), comic.genres)
        assertEquals("lumos", comic.source)
    }

    @Test
    fun `ChapterSummaryDto maps correctly`() {
        val dto = ChapterSummaryDto(
            slug = "chapter-10",
            number = "10",
            title = "Chapter 10",
            timeAgo = "2 jam lalu"
        )

        val chapter = dto.toDomain()

        assertEquals("chapter-10", chapter.slug)
        assertEquals("10", chapter.number)
        assertEquals("Chapter 10", chapter.title)
        assertEquals("2 jam lalu", chapter.timeAgo)
    }

    @Test
    fun `null fields are handled safely`() {
        val dto = ComicListItemDto(
            title = "Minimal",
            slug = "minimal"
        )

        val comic = dto.toDomain("shinigami")

        assertEquals("Minimal", comic.title)
        assertNull(comic.coverUrl)
        assertNull(comic.rating)
        assertEquals(emptyList<String>(), comic.genres)
    }
}
