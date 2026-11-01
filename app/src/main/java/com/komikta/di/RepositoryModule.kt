package com.komikta.di

import com.komikta.data.repository.ComicRepositoryImpl
import com.komikta.domain.repository.ComicRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun bindComicRepository(impl: ComicRepositoryImpl): ComicRepository
}
