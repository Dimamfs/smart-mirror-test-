import { useCallback, useEffect, useMemo, useState } from 'react'

function getFullscreenElement() {
  if (typeof document === 'undefined') return null
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement ||
    null
  )
}

function getFullscreenEnabled() {
  if (typeof document === 'undefined') return false
  return Boolean(
    document.fullscreenEnabled ||
      document.webkitFullscreenEnabled ||
      document.mozFullScreenEnabled ||
      document.msFullscreenEnabled,
  )
}

function requestFullscreen(target) {
  if (!target) return
  const method =
    target.requestFullscreen ||
    target.webkitRequestFullscreen ||
    target.mozRequestFullScreen ||
    target.msRequestFullscreen
  if (method) {
    method.call(target)
  }
}

function exitFullscreen() {
  if (typeof document === 'undefined') return
  const method =
    document.exitFullscreen ||
    document.webkitExitFullscreen ||
    document.mozCancelFullScreen ||
    document.msExitFullscreen
  if (method) {
    method.call(document)
  }
}

const FULLSCREEN_EVENTS = [
  'fullscreenchange',
  'webkitfullscreenchange',
  'mozfullscreenchange',
  'MSFullscreenChange',
]

export default function useFullscreen(targetRef) {
  const [supported, setSupported] = useState(() => getFullscreenEnabled())
  const [isFullscreen, setIsFullscreen] = useState(() => {
    const element = getFullscreenElement()
    return element !== null
  })
  const [buttonVisible, setButtonVisible] = useState(false)

  useEffect(() => {
    setSupported(getFullscreenEnabled())
    if (!getFullscreenEnabled()) {
      setButtonVisible(false)
    } else {
      setButtonVisible(true)
    }
  }, [])

  useEffect(() => {
    if (!supported) return undefined

    const handleChange = () => {
      const element = getFullscreenElement()
      setIsFullscreen(element !== null && element === targetRef.current)
    }

    FULLSCREEN_EVENTS.forEach((event) =>
      document.addEventListener(event, handleChange, { passive: true }),
    )

    return () => {
      FULLSCREEN_EVENTS.forEach((event) =>
        document.removeEventListener(event, handleChange),
      )
    }
  }, [supported, targetRef])

  const toggleFullscreen = useCallback(() => {
    if (!supported) return
    const current = getFullscreenElement()
    if (current && current === targetRef.current) {
      exitFullscreen()
    } else {
      requestFullscreen(targetRef.current)
    }
  }, [supported, targetRef])

  const buttonInteractionProps = useMemo(
    () => ({
      onMouseEnter: () => setButtonVisible(true),
      onMouseLeave: () => setButtonVisible(true),
      onFocus: () => setButtonVisible(true),
      onBlur: () => setButtonVisible(true),
    }),
    [],
  )

  return {
    isFullscreen,
    toggleFullscreen,
    showButton: supported && buttonVisible,
    supported,
    buttonInteractionProps,
  }
}
