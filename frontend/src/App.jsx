import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL

const TMDB_GENRES = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
}

let youtubeApiPromise

const loadYouTubeApi = () => {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT)
  }

  if (!youtubeApiPromise) {
    youtubeApiPromise = new Promise((resolve, reject) => {
      const previousCallback = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        previousCallback?.()
        resolve(window.YT)
      }

      let script = document.querySelector('script[data-youtube-iframe-api]')
      if (!script) {
        script = document.createElement('script')
        script.src = 'https://www.youtube.com/iframe_api'
        script.dataset.youtubeIframeApi = 'true'
        script.onerror = reject
        document.head.appendChild(script)
      }
    })
  }

  return youtubeApiPromise
}

const selectTrailerVideos = (videos = []) => {
  const priority = (video) => {
    if (video.official && video.type === 'Trailer') return 0
    if (video.official && video.type === 'Teaser') return 1
    if (video.type === 'Trailer') return 2
    return 3
  }

  return videos
    .filter(
      (video) =>
        video.site === 'YouTube' &&
        (video.type === 'Trailer' || video.type === 'Teaser') &&
        video.key
    )
    .sort((left, right) => {
      const priorityDifference = priority(left) - priority(right)
      if (priorityDifference) return priorityDifference

      const languageDifference =
        Number(right.iso_639_1 === 'en') - Number(left.iso_639_1 === 'en')
      if (languageDifference) return languageDifference

      const qualityDifference = (right.size || 0) - (left.size || 0)
      if (qualityDifference) return qualityDifference

      return new Date(right.published_at || 0) - new Date(left.published_at || 0)
    })
}

function App() {
  const [movies, setMovies] = useState([])
  const [loading, setLoading] = useState(true)
  const [featuredMovie, setFeaturedMovie] = useState(null)
  const [featuredLoading, setFeaturedLoading] = useState(true)
  const [featuredVisible, setFeaturedVisible] = useState(true)
  const [featuredDesktop, setFeaturedDesktop] = useState(() =>
    window.matchMedia('(min-width: 901px)').matches
  )
  const [featuredMotionAllowed, setFeaturedMotionAllowed] = useState(() =>
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  const [featuredSoundOn, setFeaturedSoundOn] = useState(false)
  const [featuredPlayerReady, setFeaturedPlayerReady] = useState(false)
  const [featuredPlayerFailed, setFeaturedPlayerFailed] = useState(false)
  const [featuredPreviewSuspended, setFeaturedPreviewSuspended] = useState(false)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')

  const [showModal, setShowModal] = useState(false)
  const [editingMovie, setEditingMovie] = useState(null)
  const [submittingMovie, setSubmittingMovie] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const [tmdbResults, setTmdbResults] = useState([])

const [searchingMovies, setSearchingMovies] = useState(false)

const [selectedTmdbMovie, setSelectedTmdbMovie] = useState(null)

  const [activePreviewMovieId, setActivePreviewMovieId] = useState(null)
  const [activePreviewVideoKey, setActivePreviewVideoKey] = useState('')

  const [detailsMovie, setDetailsMovie] = useState(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsSoundOn, setDetailsSoundOn] = useState(false)
  const [detailsTrailerIndex, setDetailsTrailerIndex] = useState(0)
  const [detailsTrailerFailed, setDetailsTrailerFailed] = useState(false)
  const [detailsTrailerReady, setDetailsTrailerReady] = useState(false)
  const detailsTrailerRef = useRef(null)
  const detailsSoundOnRef = useRef(false)
  const detailsTrailerContainerRef = useRef(null)
  const featuredHeroRef = useRef(null)
  const featuredPlayerHostRef = useRef(null)
  const featuredPlayerRef = useRef(null)
  const featuredStartTimeoutRef = useRef(null)
  const featuredSoundOnRef = useRef(false)
  const previewTimeoutRef = useRef(null)
  const previewStopTimeoutRef = useRef(null)
  const [form, setForm] = useState({
    title: '',
    genre: '',
    releaseYear: '',
    status: 'Want to Watch',
  })

  useEffect(() => {
    let isCurrent = true

    axios.get(API_URL)
      .then((response) => {
        if (isCurrent) {
          setMovies(response.data)
        }
      })
      .catch((error) => {
        console.error('Error fetching movies:', error)
      })
      .finally(() => {
        if (isCurrent) {
          setLoading(false)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    let isCurrent = true

    axios.get(`${API_URL}/featured`)
      .then((response) => {
        if (isCurrent) {
          setFeaturedMovie(response.data)
        }
      })
      .catch((error) => {
        console.error('Error fetching featured movie:', error)
      })
      .finally(() => {
        if (isCurrent) {
          setFeaturedLoading(false)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 901px)')
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreferences = () => {
      setFeaturedDesktop(desktopQuery.matches)
      setFeaturedMotionAllowed(!motionQuery.matches)
    }

    desktopQuery.addEventListener('change', updatePreferences)
    motionQuery.addEventListener('change', updatePreferences)

    return () => {
      desktopQuery.removeEventListener('change', updatePreferences)
      motionQuery.removeEventListener('change', updatePreferences)
    }
  }, [])

  useEffect(() => {
    const heroElement = featuredHeroRef.current

    if (!heroElement || !('IntersectionObserver' in window)) {
      return undefined
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setFeaturedVisible(entry.isIntersecting)
        if (!entry.isIntersecting) {
          featuredSoundOnRef.current = false
          setFeaturedSoundOn(false)
          setFeaturedPlayerReady(false)
        }
      },
      { threshold: 0.25 }
    )
    observer.observe(heroElement)

    return () => observer.disconnect()
  }, [])

  const searchTmdbMovies = async (query) => {
    if (!query.trim()) {
      setTmdbResults([])
      return
    }

    setSearchingMovies(true)

    try {
      const response = await axios.get(
        `${API_URL}/search`,
        {
          params: {
            query: query,
          },
        }
      )

      setTmdbResults(response.data)
    } catch (error) {
      console.error('Error searching TMDB:', error)
      setTmdbResults([])
    } finally {
      setSearchingMovies(false)
    }
  }

  const handleEditMovieClick = (movie) => {
    setEditingMovie(movie)
    setForm({
      title: movie.title,
      genre: movie.genre,
      releaseYear: String(movie.releaseYear),
      status: movie.status,
    })
    setShowModal(true)
    setTmdbResults([])
  }

  const openMovieDetails = async (movie) => {
    stopPreview()
    detailsSoundOnRef.current = false
    setDetailsSoundOn(false)
    setDetailsTrailerIndex(0)
    setDetailsTrailerFailed(false)
    setDetailsTrailerReady(false)
    setDetailsLoading(true)
    setDetailsMovie(movie)

    try {
      const tmdbId = movie?.tmdbId ?? movie?.id ?? null
      const response = tmdbId
        ? await axios.get(`${API_URL}/details/${tmdbId}`)
        : await axios.post(`${API_URL}/${movie._id}/resolve-tmdb`)
      const details = response.data

      setDetailsMovie({
        ...movie,
        ...details,
        status: movie.status,
        overview: details.overview || movie.overview || '',
        tmdbId: details.tmdbId || details.id || tmdbId,
      })
      setDetailsTrailerFailed(false)
    } catch (error) {
      console.error('Error fetching movie details:', error)
    } finally {
      setDetailsLoading(false)
    }
  }

  const addMovie = async (e) => {
    e.preventDefault()
    setSubmitError('')
    setSubmittingMovie(true)

    try {
      const response = await axios.post(API_URL, {
        ...form,
        releaseYear: Number(form.releaseYear),
        posterPath: selectedTmdbMovie?.poster_path || '',
        tmdbId: selectedTmdbMovie?.id || null,
        overview: selectedTmdbMovie?.overview || '',
      })

      setMovies((currentMovies) => [...currentMovies, response.data])
      setShowModal(false)

      setForm({
        title: '',
        genre: '',
        releaseYear: '',
        status: 'Want to Watch',
      })

      setSelectedTmdbMovie(null)
    } catch (error) {
      console.error('Error adding movie:', error)
      setSubmitError(
        error.response?.data?.message || 'Could not add this movie. Please try again.'
      )
    } finally {
      setSubmittingMovie(false)
    }
  }

  const deleteMovie = async (id) => {
    try {
      await axios.delete(`${API_URL}/${id}`)
      setMovies(movies.filter((movie) => movie._id !== id))
    } catch (error) {
      console.error('Error deleting movie:', error)
    }
  }

  const editMovie = async (e) => {
    e.preventDefault()

    try {
      const response = await axios.put(`${API_URL}/${editingMovie._id}`, {
        ...form,
        releaseYear: Number(form.releaseYear),
        tmdbId: selectedTmdbMovie?.id || editingMovie?.tmdbId || null,
        posterPath: selectedTmdbMovie?.poster_path || editingMovie?.posterPath || '',
        overview: selectedTmdbMovie?.overview || editingMovie?.overview || '',
      })

      setMovies((currentMovies) =>
        currentMovies.map((movie) =>
          movie._id === editingMovie._id ? response.data : movie
        )
      )

      setEditingMovie(null)
      setShowModal(false)

      setForm({
        title: '',
        genre: '',
        releaseYear: '',
        status: 'Want to Watch',
      })
      setSelectedTmdbMovie(null)
    } catch (error) {
      console.error('Error updating movie:', error)
    }
  }

  const filteredMovies = movies.filter((movie) => {
    const matchesSearch = movie.title
      .toLowerCase()
      .includes(search.toLowerCase())

    const matchesFilter =
      filter === 'All' || movie.status === filter

    return matchesSearch && matchesFilter
  })

  const totalMovies = movies.length

  const wantToWatch = movies.filter(
    (movie) => movie.status === 'Want to Watch'
  ).length

  const watching = movies.filter(
    (movie) => movie.status === 'Watching'
  ).length

  const watched = movies.filter(
    (movie) => movie.status === 'Watched'
  ).length

  const stopPreview = (resumeFeatured = true) => {
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
      previewTimeoutRef.current = null
    }

    if (previewStopTimeoutRef.current) {
      clearTimeout(previewStopTimeoutRef.current)
      previewStopTimeoutRef.current = null
    }

    setActivePreviewMovieId(null)
    setActivePreviewVideoKey('')
    if (resumeFeatured) {
      setFeaturedPreviewSuspended(false)
    }
  }

  const startPreview = async (movie) => {
    const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches

    if (!supportsHover || !movie?.title) {
      return
    }

    setFeaturedPreviewSuspended(true)

    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
    }

    previewTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await axios.get(`${API_URL}/video-preview`, {
          params: {
            title: movie.title,
          },
        })

        const videoKey = response.data?.key

        if (!videoKey) {
          setFeaturedPreviewSuspended(false)
          return
        }

        stopPreview(false)
        setActivePreviewMovieId(movie._id)
        setActivePreviewVideoKey(videoKey)

        previewStopTimeoutRef.current = setTimeout(() => {
          stopPreview()
        }, 20000)
      } catch (error) {
        console.error('Error fetching movie preview:', error)
        setFeaturedPreviewSuspended(false)
      }
    }, 700)
  }

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setDetailsMovie(null)
      }
    }

    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('keydown', handleEscape)
      stopPreview()
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    let player
    const playerHost = featuredPlayerHostRef.current
    const canPlay =
      featuredMovie?.featured_trailer_key &&
      featuredVisible &&
      featuredDesktop &&
      featuredMotionAllowed &&
      !featuredPreviewSuspended &&
      !activePreviewMovieId &&
      !detailsMovie &&
      !showModal

    if (!canPlay || !playerHost || featuredPlayerFailed) {
      return undefined
    }

    loadYouTubeApi()
      .then((youtube) => {
        if (!isMounted || !playerHost.isConnected) {
          return
        }

        const playerTarget = document.createElement('div')
        playerHost.replaceChildren(playerTarget)
        player = new youtube.Player(playerTarget, {
          host: 'https://www.youtube-nocookie.com',
          videoId: featuredMovie.featured_trailer_key,
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            enablejsapi: 1,
            fs: 0,
            iv_load_policy: 3,
            loop: 1,
            modestbranding: 1,
            mute: 1,
            origin: window.location.origin,
            playsinline: 1,
            playlist: featuredMovie.featured_trailer_key,
            rel: 0,
          },
          events: {
            onReady: (event) => {
              if (!isMounted) return
              featuredPlayerRef.current = event.target
              event.target.mute()
              if (featuredSoundOnRef.current) {
                event.target.unMute()
              }
              event.target.playVideo()
              setFeaturedPlayerReady(true)
              featuredStartTimeoutRef.current = setTimeout(() => {
                if (isMounted && event.target.getPlayerState() !== window.YT.PlayerState.PLAYING) {
                  setFeaturedPlayerFailed(true)
                  setFeaturedPlayerReady(false)
                }
              }, 12000)
            },
            onStateChange: (event) => {
              if (event.data === window.YT.PlayerState.PLAYING && isMounted) {
                if (featuredStartTimeoutRef.current) {
                  clearTimeout(featuredStartTimeoutRef.current)
                  featuredStartTimeoutRef.current = null
                }
                setFeaturedPlayerReady(true)
              }
              if (event.data === window.YT.PlayerState.ENDED && isMounted) {
                event.target.seekTo(0)
                event.target.playVideo()
              }
            },
            onError: () => {
              if (isMounted) {
                setFeaturedPlayerFailed(true)
                setFeaturedPlayerReady(false)
              }
            },
          },
        })
      })
      .catch(() => {
        if (isMounted) {
          setFeaturedPlayerFailed(true)
        }
      })

    return () => {
      isMounted = false
      if (featuredStartTimeoutRef.current) {
        clearTimeout(featuredStartTimeoutRef.current)
        featuredStartTimeoutRef.current = null
      }
      player?.destroy()
      playerHost.replaceChildren()
      featuredPlayerRef.current = null
    }
  }, [featuredMovie, featuredVisible, featuredDesktop, featuredMotionAllowed, featuredPreviewSuspended, activePreviewMovieId, detailsMovie, showModal, featuredPlayerFailed])

  const toggleFeaturedSound = () => {
    const player = featuredPlayerRef.current
    if (!player) return

    const soundOn = !featuredSoundOnRef.current
    featuredSoundOnRef.current = soundOn
    if (soundOn) {
      player.unMute()
    } else {
      player.mute()
    }
    setFeaturedSoundOn(soundOn)
  }

  const openFeaturedDetails = () => {
    if (!featuredMovie) return
    openMovieDetails({
      ...featuredMovie,
      tmdbId: featuredMovie.id,
      genre: (featuredMovie.genres || []).map((genre) => genre.name).join(', '),
      releaseYear: Number(featuredMovie.release_date?.slice(0, 4)) || '',
      status: 'Featured Now',
    })
  }

  const trailerCandidates = useMemo(
    () => selectTrailerVideos(detailsMovie?.videos?.results),
    [detailsMovie?.videos?.results]
  )
  const trailerKey = trailerCandidates[detailsTrailerIndex]?.key || null

  useEffect(() => {
    let isMounted = true
    let player
    const playerHost = detailsTrailerContainerRef.current

    if (!detailsMovie || detailsLoading || detailsTrailerFailed) {
      return undefined
    }

    if (!trailerKey) {
      return undefined
    }

    loadYouTubeApi()
      .then((youtube) => {
        if (!isMounted || !playerHost) {
          return
        }

        const playerTarget = document.createElement('div')
        playerHost.replaceChildren(playerTarget)
        player = new youtube.Player(playerTarget, {
          host: 'https://www.youtube-nocookie.com',
          videoId: trailerKey,
          playerVars: {
            autoplay: 1,
            enablejsapi: 1,
            mute: 1,
            modestbranding: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0,
          },
          events: {
            onReady: (event) => {
              if (!isMounted) {
                return
              }

              detailsTrailerRef.current = event.target
              event.target.mute()
              if (detailsSoundOnRef.current) {
                event.target.unMute()
              }
              event.target.playVideo()
              setDetailsTrailerReady(true)
            },
            onError: () => {
              if (!isMounted) {
                return
              }

              setDetailsTrailerReady(false)
              if (detailsTrailerIndex + 1 >= trailerCandidates.length) {
                setDetailsTrailerFailed(true)
              } else {
                setDetailsTrailerIndex((currentIndex) => currentIndex + 1)
              }
            },
          },
        })
      })
      .catch(() => {
        if (isMounted) {
          setDetailsTrailerFailed(true)
        }
      })

    return () => {
      isMounted = false
      if (player) {
        player.destroy()
      }
      playerHost?.replaceChildren()
      detailsTrailerRef.current = null
    }
  }, [detailsMovie, detailsLoading, detailsTrailerFailed, detailsTrailerIndex, trailerCandidates, trailerKey])

  const toggleDetailsSound = () => {
    const player = detailsTrailerRef.current

    if (!player) {
      return
    }

    const soundOn = !detailsSoundOnRef.current
    detailsSoundOnRef.current = soundOn

    if (soundOn) {
      player.unMute()
    } else {
      player.mute()
    }
    setDetailsSoundOn(soundOn)
  }

  return (
    <div className="app">

      {/* NAVBAR */}
      <nav className="navbar">
        <div className="nav-container">
          <div className="logo">
            🎬 <span>Movie<span className="accent">Watchlist</span></span>
          </div>

          <button
            className="nav-add-btn"
            onClick={() => {
              setSubmitError('')
              setShowModal(true)
            }}
          >
            + Add Movie
          </button>
        </div>
      </nav>


      {/* FEATURED NOW */}
      <section
        className={`featured-hero${featuredMovie ? ' featured-hero--loaded' : ''}`}
        ref={featuredHeroRef}
        aria-label="Featured movie"
      >
        <div className="featured-backdrop" key={featuredMovie?.id || 'featured-loading'}>
          {featuredMovie?.backdrop_path && (
            <img
              className="featured-backdrop-image"
              src={`https://image.tmdb.org/t/p/original${featuredMovie.backdrop_path}`}
              alt=""
              fetchPriority="high"
            />
          )}
        </div>
        {featuredMovie?.featured_trailer_key && !featuredPlayerFailed && (
          <div className="featured-video-frame" aria-hidden="true">
            <div ref={featuredPlayerHostRef} className="featured-video-host" />
          </div>
        )}
        <div className="featured-gradient featured-gradient--side" />
        <div className="featured-gradient featured-gradient--bottom" />

        <div className="featured-content">
          <p className="featured-kicker">
            <span className="featured-live-dot" />
            {featuredMovie ? 'FEATURED NOW' : featuredLoading ? 'CURATING TONIGHT' : 'YOUR PERSONAL CINEMA'}
          </p>

          <h1 className="featured-title">
            {featuredMovie?.title || (featuredLoading ? 'A story worth watching.' : 'Your movie universe.')}
          </h1>

          {featuredMovie ? (
            <>
              <div className="featured-metadata">
                <span>{featuredMovie.release_date?.slice(0, 4)}</span>
                <span className="featured-meta-divider" />
                <span>{(featuredMovie.genres || []).map((genre) => genre.name).join(' · ') || 'Movie'}</span>
                <span className="featured-rating">⭐ {featuredMovie.vote_average?.toFixed(1) || 'N/A'}</span>
              </div>
              <p className="featured-overview">
                {featuredMovie.overview || 'A new story is ready to discover.'}
              </p>
            </>
          ) : (
            <p className="featured-overview">
              {featuredLoading
                ? 'Finding a recent favorite for your next movie night.'
                : 'Keep track of the movies you want to watch, are watching, and have already watched.'}
            </p>
          )}

          <div className="featured-actions">
            {featuredMovie?.featured_trailer_key && (
              <a
                className="featured-primary-btn"
                href={`https://www.youtube.com/watch?v=${featuredMovie.featured_trailer_key}`}
                target="_blank"
                rel="noreferrer"
              >
                <span aria-hidden="true">▶</span> Watch Trailer
              </a>
            )}
            {featuredMovie && (
              <button className="featured-secondary-btn" onClick={openFeaturedDetails}>
                View Details
              </button>
            )}
            {featuredMovie?.featured_trailer_key && !featuredPlayerFailed && (
              <button
                className="featured-sound-btn"
                type="button"
                onClick={toggleFeaturedSound}
                disabled={!featuredPlayerReady}
                aria-pressed={featuredSoundOn}
              >
                {featuredSoundOn ? '🔊 Sound On' : '🔇 Sound Off'}
              </button>
            )}
          </div>

          <p className="featured-attribution">Movie data and artwork provided by TMDB</p>
        </div>

        <div className="featured-index" aria-hidden="true">
          <span>01</span>
          <span className="featured-index-line" />
          <span>FEATURED</span>
        </div>
      </section>


      {/* STATS */}
      <section className="stats-container">

        <div className="stat-card">
          <div className="stat-icon">🎞️</div>
          <div>
            <p>Total Movies</p>
            <h2>{totalMovies}</h2>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">🍿</div>
          <div>
            <p>Want to Watch</p>
            <h2>{wantToWatch}</h2>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">▶️</div>
          <div>
            <p>Watching</p>
            <h2>{watching}</h2>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">✓</div>
          <div>
            <p>Watched</p>
            <h2>{watched}</h2>
          </div>
        </div>

      </section>


      {/* MOVIE SECTION */}
      <main className="movies-container">

        <div className="section-header">

          <div>
            <p className="eyebrow">YOUR COLLECTION</p>
            <h2>My Movies</h2>
          </div>

          <div className="search-box">
            🔎
            <input
              type="text"
              placeholder="Search movies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

        </div>


        {/* FILTERS */}
        <div className="filters">

          {['All', 'Want to Watch', 'Watching', 'Watched'].map(
            (item) => (
              <button
                key={item}
                className={filter === item ? 'filter active' : 'filter'}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            )
          )}

        </div>


        {/* MOVIES */}
        {loading ? (

          <div className="empty-state">
            <div className="loading">🎬</div>
            <h3>Loading your collection...</h3>
          </div>

        ) : filteredMovies.length === 0 ? (

          <div className="empty-state">

            <div className="empty-icon">🍿</div>

            <h3>
              {movies.length === 0
                ? 'Your watchlist is empty'
                : 'No movies found'}
            </h3>

            <p>
              {movies.length === 0
                ? 'Add a movie and start building your collection.'
                : 'Try another search or filter.'}
            </p>

            {movies.length === 0 && (
              <button
                className="hero-btn"
                onClick={() => {
                  setSubmitError('')
                  setShowModal(true)
                }}
              >
                + Add Movie
              </button>
            )}

          </div>

        ) : (

          <div className="movie-grid">

            {filteredMovies.map((movie) => (

              <div
                className="movie-card"
                key={movie._id}
                onMouseEnter={() => startPreview(movie)}
                onMouseLeave={stopPreview}
                onClick={(event) => {
                  if (event.target.closest('button')) {
                    return
                  }

                  openMovieDetails(movie)
                }}
              >

                <div className="movie-poster">
  {activePreviewMovieId === movie._id && activePreviewVideoKey ? (
    <div className="movie-preview-container">
      <div className="movie-preview-overlay" />
      <iframe
        className="movie-preview-video"
        src={`https://www.youtube.com/embed/${activePreviewVideoKey}?autoplay=1&mute=1&loop=1&controls=0&playlist=${activePreviewVideoKey}&rel=0&modestbranding=1`}
        title={`${movie.title} trailer preview`}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen={false}
      />
    </div>
  ) : movie.posterPath ? (
    <img
      src={`https://image.tmdb.org/t/p/w500${movie.posterPath}`}
      alt={movie.title}
    />
  ) : (
    <span>🎬</span>
  )}
</div>

                <div className="movie-info">

                  <div className="movie-title-row">
                    <h3>{movie.title}</h3>

                    <div className="movie-actions">

  <button
    className="edit-btn"
    onClick={(event) => {
      event.stopPropagation()
      handleEditMovieClick(movie)
    }}
    title="Edit movie"
  >
    ✏️
  </button>

  <button
    className="delete-btn"
    onClick={(event) => {
      event.stopPropagation()
      deleteMovie(movie._id)
    }}
    title="Delete movie"
  >
    🗑️
  </button>

</div>
                  </div>

                  <p className="movie-meta">
                    {movie.genre} • {movie.releaseYear}
                  </p>

                  <span
                    className={`status ${
                      movie.status
                        .toLowerCase()
                        .replaceAll(' ', '-')
                    }`}
                  >
                    {movie.status}
                  </span>

                </div>

              </div>

            ))}

          </div>

        )}

      </main>


      {/* ADD MOVIE MODAL */}
      {detailsMovie && (

        <div
          className="details-modal-overlay"
          onClick={() => setDetailsMovie(null)}
        >
          <div
            className="details-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="details-close-btn"
              onClick={() => setDetailsMovie(null)}
              aria-label="Close movie details"
            >
              ×
            </button>

            <>
                <div className="details-backdrop-wrap">
                  {(detailsMovie.backdrop_path || detailsMovie.poster_path || detailsMovie.posterPath) ? (
                    <img
                      className="details-backdrop"
                      src={
                        detailsMovie.backdrop_path
                          ? `https://image.tmdb.org/t/p/original${detailsMovie.backdrop_path}`
                          : `https://image.tmdb.org/t/p/original${detailsMovie.poster_path || detailsMovie.posterPath}`
                      }
                      alt=""
                    />
                  ) : (
                    <div className="details-backdrop details-backdrop--empty" />
                  )}
                  <div className="details-backdrop-overlay" />
                </div>

                <div className="details-content">
                  <img
                    className="details-poster"
                    src={
                      detailsMovie.poster_path
                        ? `https://image.tmdb.org/t/p/w300${detailsMovie.poster_path}`
                        : detailsMovie.posterPath
                          ? `https://image.tmdb.org/t/p/w300${detailsMovie.posterPath}`
                          : ''
                    }
                    alt={detailsMovie.title || 'Movie poster'}
                  />

                  <div className="details-info">
                    <p className="eyebrow details-eyebrow">NOW PLAYING</p>
                    <h2>{detailsMovie.title || 'Movie Details'}</h2>

                    <div className="details-meta-row">
                      <span>{detailsMovie.release_date ? detailsMovie.release_date.slice(0, 4) : detailsMovie.releaseYear || 'N/A'}</span>
                      <span>{detailsMovie.genres ? detailsMovie.genres.map((genre) => genre.name).join(', ') : detailsMovie.genre || 'Genre unavailable'}</span>
                      <span>{detailsMovie.runtime ? `${detailsMovie.runtime} min` : ''}</span>
                    </div>

                    <div className="details-score-row">
                      <span>⭐ {detailsMovie.vote_average ? detailsMovie.vote_average.toFixed(1) : 'N/A'}</span>
                      <span>{detailsMovie.original_language ? detailsMovie.original_language.toUpperCase() : 'N/A'}</span>
                      <span className="details-status-badge">{detailsMovie.status || 'Want to Watch'}</span>
                    </div>

                    <p className="details-overview">
                      {detailsMovie.overview || (detailsLoading ? 'Loading movie details...' : 'No description available for this movie yet.')}
                    </p>
                  </div>
                </div>

                <section className="details-trailer-section" aria-label="Movie trailer">
                  <div className="details-trailer-heading">
                    <span className="details-trailer-label">TRAILER</span>
                    {detailsLoading && <span className="details-trailer-loading">Loading preview...</span>}
                  </div>
                  <div className="details-trailer-frame">
                    {trailerKey && !detailsTrailerFailed ? (
                      <>
                        <div
                          className="details-youtube-player"
                          ref={detailsTrailerContainerRef}
                          title={`${detailsMovie.title || 'Movie'} trailer`}
                        />
                        <div className="details-trailer-gradient" />
                        <button
                          className="details-sound-btn"
                          type="button"
                          onClick={toggleDetailsSound}
                          aria-pressed={detailsSoundOn}
                          disabled={!detailsTrailerReady}
                        >
                          {detailsSoundOn ? '🔊 Sound On' : '🔇 Sound Off'}
                        </button>
                        {!detailsTrailerReady && (
                          <span className="details-trailer-starting">Loading trailer...</span>
                        )}
                      </>
                    ) : (
                      <div className="details-trailer-fallback">
                        {(detailsMovie.backdrop_path || detailsMovie.poster_path || detailsMovie.posterPath) && (
                          <img
                            src={
                              detailsMovie.backdrop_path
                                ? `https://image.tmdb.org/t/p/w1280${detailsMovie.backdrop_path}`
                                : `https://image.tmdb.org/t/p/w780${detailsMovie.poster_path || detailsMovie.posterPath}`
                            }
                            alt=""
                          />
                        )}
                        <div className="details-trailer-gradient" />
                        <span>{detailsLoading ? 'Finding the official trailer...' : 'No official trailer available'}</span>
                      </div>
                    )}
                  </div>
                </section>
              </>
          </div>
        </div>
      )}

      {showModal && (

        <div
          className="modal-overlay"
          onClick={() => {
  setShowModal(false)
  setEditingMovie(null)
  setSubmitError('')
}}
        >

          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >

            <div className="modal-header">
              <div>
                <p className="eyebrow">
  {editingMovie ? 'EDIT ENTRY' : 'NEW ENTRY'}
</p>

<h2>
  {editingMovie ? 'Edit Movie' : 'Add Movie'}
</h2>
              </div>

              <button
                className="close-btn"
                onClick={() => {
  setShowModal(false)
  setEditingMovie(null)
      setSubmitError('')
}}
              >
                ×
              </button>
            </div>


            <form onSubmit={editingMovie ? editMovie : addMovie}>

              <label>Movie Title</label>

<input
  type="text"
  placeholder="Search for a movie..."
  value={form.title}
  onChange={(e) => {
    const value = e.target.value

    setForm({
      ...form,
      title: value,
    })

    searchTmdbMovies(value)
  }}
  required
/>

{searchingMovies && (
  <p style={{ marginTop: '8px' }}>
    🔎 Searching movies...
  </p>
)}

{tmdbResults.length > 0 && !editingMovie && (
  <div className="tmdb-results">
    {tmdbResults.slice(0, 5).map((movie) => (
      <div
        key={movie.id}
        className="tmdb-result"
        onClick={() => {
          const mappedGenres = (movie.genre_ids || [])
            .map((id) => TMDB_GENRES[id])
            .filter(Boolean)

          setSelectedTmdbMovie(movie)
          setSubmitError('')

          setForm({
            ...form,
            title: movie.title,
            genre: mappedGenres.join(', '),
            releaseYear: movie.release_date
              ? movie.release_date.slice(0, 4)
              : '',
          })

          setTmdbResults([])
        }}
      >
        {movie.poster_path ? (
          <img
            src={`https://image.tmdb.org/t/p/w92${movie.poster_path}`}
            alt={movie.title}
          />
        ) : (
          <div>🎬</div>
        )}

        <div>
          <strong>{movie.title}</strong>

          <p>
            {movie.release_date
              ? movie.release_date.slice(0, 4)
              : 'Unknown year'}
          </p>
        </div>
      </div>
    ))}
  </div>
)}


              <label>Genre</label>

              <input
                type="text"
                placeholder="e.g. Science Fiction"
                value={form.genre}
                onChange={(e) =>
                  setForm({
                    ...form,
                    genre: e.target.value,
                  })
                }
                required
              />


              <label>Release Year</label>

              <input
                type="number"
                placeholder="e.g. 2014"
                min="1888"
                max="2100"
                value={form.releaseYear}
                onChange={(e) =>
                  setForm({
                    ...form,
                    releaseYear: e.target.value,
                  })
                }
                required
              />


              <label>Viewing Status</label>

              <select
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value,
                  })
                }
              >
                <option>Want to Watch</option>
                <option>Watching</option>
                <option>Watched</option>
              </select>


              {submitError && (
                <p className="form-error" role="alert">{submitError}</p>
              )}

              <button
                className="submit-btn"
                type="submit"
                disabled={submittingMovie}
              >
                {submittingMovie
                  ? 'Adding Movie...'
                  : editingMovie
                    ? 'Save Changes ✓'
                    : 'Add to Watchlist 🎬'}
              </button>

            </form>

          </div>

        </div>

      )}

    </div>
  )
}

export default App
