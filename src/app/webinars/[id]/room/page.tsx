'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { socketService, Participant, ChatMessage } from '@/services/socketService'
import { useWebRTC } from '@/hooks/useWebRTC'

interface Webinar {
  _id: string
  title: string
  description: string
  scheduledDate: string
  duration: number
  maxParticipants: number
  status: 'scheduled' | 'live' | 'ended'
  isPublic: boolean
  host: {
    _id: string
    username: string
    firstName: string
    lastName: string
  }
  participants: any[]
  settings: {
    allowChat: boolean
    allowReactions: boolean
    allowScreenShare: boolean
    allowRecording: boolean
    waitingRoom: boolean
    requireApproval: boolean
  }
}

interface ParticipantPermissions {
  canPresent: boolean
  canShareScreen: boolean
  canChat: boolean
  canReact: boolean
}

// Remote Video Component
const RemoteVideo = ({ participant, stream }: { participant: Participant, stream?: MediaStream }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isVideoReady, setIsVideoReady] = useState(false)

  useEffect(() => {
    if (videoRef.current && stream) {
      console.log('Setting remote stream for:', participant.firstName, participant.lastName)
      videoRef.current.srcObject = stream
      
      videoRef.current.onloadedmetadata = () => {
        console.log('Remote video metadata loaded for:', participant.firstName)
        setIsVideoReady(true)
      }

      videoRef.current.oncanplay = () => {
        videoRef.current?.play().catch(e => console.error('Remote video play failed:', e))
      }
    }
  }, [stream, participant])

  return (
    <div className="bg-gray-700 rounded-lg overflow-hidden relative" style={{ minHeight: '200px' }}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
          style={{
            minHeight: '200px',
            width: '100%',
            height: '100%',
            backgroundColor: '#374151'
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-gray-400" style={{ minHeight: '200px' }}>
          <div className="text-center">
            <div className="w-16 h-16 bg-gray-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl font-medium">
                {participant?.firstName?.charAt(0) || '?'}
              </span>
            </div>
            <p>No video</p>
          </div>
        </div>
      )}
      
      {!participant.videoEnabled && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-700 bg-opacity-80">
          <div className="text-center text-gray-400">
            <div className="w-16 h-16 bg-gray-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl font-medium">
                {participant?.firstName?.charAt(0) || '?'}
              </span>
            </div>
            <p>Camera off</p>
          </div>
        </div>
      )}

      <div className="absolute bottom-2 left-2 text-white text-xs bg-black bg-opacity-50 px-2 py-1 rounded">
        {participant.firstName} {participant.lastName}
        {participant.role === 'host' && ' (Host)'}
      </div>

      {/* Audio/Video indicators */}
      <div className="absolute top-2 right-2 flex space-x-1">
        {!participant.audioEnabled && (
          <div className="bg-red-600 rounded-full p-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
          </div>
        )}
        {participant.screenSharing && (
          <div className="bg-blue-600 rounded-full p-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>
    </div>
  )
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'

export default function WebinarRoom() {
  const params = useParams()
  const webinarId = params?.id
  const router = useRouter()

  const [webinar, setWebinar] = useState<Webinar | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [participantRole, setParticipantRole] = useState<string>('')
  const [permissions, setPermissions] = useState<ParticipantPermissions | null>(null)
  const [user, setUser] = useState<any>(null)
  const [joined, setJoined] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [isVideoOn, setIsVideoOn] = useState(false)
  const [isAudioOn, setIsAudioOn] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [videoError, setVideoError] = useState('')
  const [isVideoLoading, setIsVideoLoading] = useState(false)
  const [needsUserInteraction, setNeedsUserInteraction] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState({
    socket: false,
    webrtc: 0,
    media: false
  })

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const localStreamRef = useRef<MediaStream | null>(null)

  // WebRTC state
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const { 
    peers, 
    initializeWebRTC, 
    handleParticipantJoined, 
    handleParticipantLeft, 
    updateLocalStream, 
    cleanup,
    connectionStates 
  } = useWebRTC(webinarId as string, user?.id || '', localStream)

  // Update connection status
  useEffect(() => {
    setConnectionStatus(prev => ({
      ...prev,
      socket: socketService.isConnected(),
      webrtc: peers.length,
      media: !!localStream
    }))
  }, [peers.length, localStream])

  // Log participants whenever the list changes
  useEffect(() => {
    console.log('=== PARTICIPANTS LIST UPDATED ===')
    const participantCount = Array.isArray(participants) ? participants.length : 0
    console.log('Total participants:', participantCount)
    console.log('WebRTC peers:', peers.length)
    console.log('Connection states:', connectionStates)
    
    if (Array.isArray(participants) && participants.length > 0) {
      participants.forEach((participant, index) => {
        if (participant) {
          const peer = peers.find(p => p.userId === participant.userId)
          console.log(`${index + 1}. ${participant?.firstName || 'Unknown'} ${participant?.lastName || 'User'} - Role: ${participant?.role || 'N/A'}, WebRTC: ${peer ? 'Connected' : 'Not connected'}`)
        }
      })
    }
    console.log('================================')
  }, [participants, peers, connectionStates])

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userData = localStorage.getItem('user')

    if (!token || !userData) {
      router.push('/login')
      return
    }

    const parsedUser = JSON.parse(userData)
    setUser(parsedUser)

    if (webinarId) {
      fetchWebinarDetails(webinarId, token)
    }
  }, [webinarId])

  // Cleanup when component unmounts or user leaves
  useEffect(() => {
    return () => {
      console.log('=== COMPONENT CLEANUP ===')
      
      // Clean up WebRTC connections
      cleanup()
      
      // Clean up local media stream
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          track.stop()
          console.log('Stopped track:', track.label)
        })
      }
      
      // Clean up socket connection and leave room
      if (joined && webinarId) {
        socketService.leaveRoom({ roomId: webinarId })
        socketService.disconnect()
      }
      
      console.log('Cleanup complete')
    }
  }, [webinarId, user, joined, cleanup])

  // Initialize media when video element is mounted and user has joined
  useEffect(() => {
    if (joined && localVideoRef.current && !localStream) {
      console.log('Video element mounted and user joined, initializing media...')
      initializeMedia()
    }
  }, [joined, localVideoRef.current])

  // Initialize WebRTC after getting participants and local stream
  useEffect(() => {
    if (joined && localStream && Array.isArray(participants) && participants.length > 1) {
      console.log('Initializing WebRTC with', participants.length, 'participants')
      // Filter out current user from participants for WebRTC
      const otherParticipants = participants.filter(p => p.userId !== user?.id)
      if (otherParticipants.length > 0) {
        initializeWebRTC(otherParticipants, localStream)
      }
    }
  }, [joined, localStream, participants.length, user?.id])

  const fetchWebinarDetails = async (id: string, token: string) => {
    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE}/api/webinars/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()

      if (data.success) {
        setWebinar(data.data)
        // Determine participant role and permissions
        const isHost = data.data.host._id === JSON.parse(localStorage.getItem('user') || '{}').id
        setParticipantRole(isHost ? 'host' : 'attendee')

        setPermissions({
          canPresent: isHost,
          canShareScreen: isHost || data.data.settings.allowScreenShare,
          canChat: data.data.settings.allowChat,
          canReact: data.data.settings.allowReactions
        })
      } else {
        setError(data.message || 'Failed to load webinar details')
      }
    } catch (error) {
      setError('Failed to load webinar details. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const setupSocketListeners = useCallback(() => {
    console.log('=== SETTING UP SOCKET LISTENERS ===')
    
    // Handle initial room join with participants list
    socketService.onRoomJoined((data) => {
      console.log('=== ROOM JOINED EVENT RECEIVED ===')
      console.log('Room ID:', data.roomId)
      console.log('Participants data:', data.participants)

      if (data.participants && Array.isArray(data.participants)) {
        const normalizedParticipants = data.participants
          .filter(participant => participant.userId || participant.id)
          .map(participant => ({
            ...participant,
            userId: participant.userId || participant.id!,
            id: participant.id || participant.userId!
          })) as Participant[]
        
        console.log('Set initial participants:', normalizedParticipants.length)
        setParticipants(normalizedParticipants)
      } else {
        console.log('No participants array received, setting empty array')
        setParticipants([])
      }
    })

    socketService.onParticipantJoined((data) => {
      console.log('=== PARTICIPANT JOINED ===')
      if (data?.user && (data.user.userId || data.user.id)) {
        console.log('New participant:', data.user.firstName, data.user.lastName)

        const normalizedParticipant: Participant = {
          ...data.user,
          userId: data.user.userId || data.user.id!,
          id: data.user.id || data.user.userId!
        }

        setParticipants(prev => {
          const participantId = normalizedParticipant.userId
          const exists = Array.isArray(prev) && prev.some(p => p.userId === participantId)

          if (exists) {
            console.log('Participant already exists, skipping duplicate')
            return prev
          }

          const newList = Array.isArray(prev) ? [...prev, normalizedParticipant] : [normalizedParticipant]
          console.log('Added new participant, total count:', newList.length)
          
          // If we have local stream, initialize WebRTC for new participant
          if (localStream) {
            console.log('Initializing WebRTC for new participant')
            handleParticipantJoined(data, localStream)
          }
          
          return newList
        })
      }
    })

    socketService.onParticipantLeft((data) => {
      console.log('=== PARTICIPANT LEFT ===')
      if (data?.userId) {
        console.log('Participant left:', data.userId)
        setParticipants(prev => {
          if (!Array.isArray(prev)) return []
          
          const filteredList = prev.filter(p => 
            p?.userId !== data.userId && p?.id !== data.userId
          )
          console.log('Participant removed, remaining count:', filteredList.length)
          
          // Handle WebRTC cleanup
          handleParticipantLeft(data)
          
          return filteredList
        })
      }
    })

    socketService.onNewMessage((message) => {
      console.log('New message received:', message)
      setChatMessages(prev => [...prev, message])
    })

    // Media control events
    socketService.onParticipantAudioChanged((data) => {
      console.log('Participant audio changed:', data)
      setParticipants(prev => 
        Array.isArray(prev) ? prev.map(p => 
          (p?.userId === data.userId || p?.id === data.userId) 
            ? { ...p, audioEnabled: data.audioEnabled }
            : p
        ) : []
      )
    })

    socketService.onParticipantVideoChanged((data) => {
      console.log('Participant video changed:', data)
      setParticipants(prev => 
        Array.isArray(prev) ? prev.map(p => 
          (p?.userId === data.userId || p?.id === data.userId) 
            ? { ...p, videoEnabled: data.videoEnabled }
            : p
        ) : []
      )
    })

    socketService.onScreenShareStarted((data) => {
      console.log('Screen share started:', data)
      setParticipants(prev => 
        Array.isArray(prev) ? prev.map(p => 
          (p?.userId === data.userId || p?.id === data.userId) 
            ? { ...p, screenSharing: true }
            : p
        ) : []
      )
    })

    socketService.onScreenShareStopped((data) => {
      console.log('Screen share stopped:', data)
      setParticipants(prev => 
        Array.isArray(prev) ? prev.map(p => 
          (p?.userId === data.userId || p?.id === data.userId) 
            ? { ...p, screenSharing: false }
            : p
        ) : []
      )
    })

    socketService.onError((error) => {
      console.error('Socket error:', error)
      setError(error.message || 'Connection error')
    })

    console.log('Socket listeners setup complete')
  }, [localStream, handleParticipantJoined, handleParticipantLeft])

  const joinWebinar = async () => {
    if (!webinar) return
    setLoading(true)
    setError('')

    try {
      const token = localStorage.getItem('token')
      if (!token) throw new Error('No token found')

      console.log('=== CONNECTING TO SOCKET ===')
      await socketService.connect(token)

      console.log('=== SETTING UP EVENT LISTENERS ===')
      setupSocketListeners()

      const response = await fetch(`${API_BASE}/api/webinars/${webinar._id}/join`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()

      if (data.success) {
        setJoined(true)
        setWebinar(data.data.webinar)
        setPermissions(data.data.participant.permissions)
        setParticipantRole(data.data.participant.role)

        console.log('=== JOINED WEBINAR SUCCESSFULLY ===')
        console.log('Room ID:', data.data.webinar.roomId || data.data.roomId)
        console.log('User role:', data.data.participant.role)

        console.log('=== JOINING SOCKET ROOM ===')
        socketService.joinRoom({ roomId: data.data.roomId || data.data.webinar.roomId || webinarId })
      } else {
        setError(data.message || 'Failed to join webinar')
      }
    } catch (error) {
      console.error('Join webinar error:', error)
      setError('Failed to join webinar. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const initializeMedia = async () => {
    try {
      console.log('Initializing media devices...')
      setIsVideoLoading(true)
      setVideoError('')

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
      })

      console.log('Media stream obtained:', stream)

      // Set local stream for WebRTC first
      setLocalStream(stream)
      localStreamRef.current = stream

      // Assign stream to video element
      if (localVideoRef.current) {
        console.log('Assigning stream to video element...')
        localVideoRef.current.srcObject = stream
        localVideoRef.current.muted = true
        localVideoRef.current.playsInline = true

        localVideoRef.current.onloadedmetadata = () => {
          console.log('Local video metadata loaded')
          setIsVideoLoading(false)
        }

        localVideoRef.current.onerror = (e) => {
          console.error('Video element error:', e)
          setVideoError('Video playback error')
          setIsVideoLoading(false)
        }

        try {
          await localVideoRef.current.play()
          console.log('Local video playing successfully')
          setNeedsUserInteraction(false)
        } catch (playError) {
          console.error('Local video play failed:', playError)
          setNeedsUserInteraction(true)
          setVideoError('Click "Start Video" to begin')
        }

        // Ensure tracks are enabled
        stream.getVideoTracks().forEach(track => {
          track.enabled = true
          console.log('Video track enabled:', track.label)
        })

        stream.getAudioTracks().forEach(track => {
          track.enabled = true
          console.log('Audio track enabled:', track.label)
        })
      }

      setIsVideoOn(true)
      setIsAudioOn(true)
      console.log('Media initialization complete')
    } catch (error) {
      console.error('Error accessing media devices:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setVideoError(`Failed to access camera and microphone: ${errorMessage}`)
      setIsVideoLoading(false)
    }
  }

  const startVideoPlayback = async () => {
    if (!localVideoRef.current) return

    try {
      setIsVideoLoading(true)
      setVideoError('')
      await localVideoRef.current.play()
      setNeedsUserInteraction(false)
      console.log('Video started manually')
    } catch (error) {
      console.error('Manual video play failed:', error)
      setVideoError('Failed to start video playback')
    } finally {
      setIsVideoLoading(false)
    }
  }

  const toggleVideo = async () => {
    if (!localStreamRef.current) return

    const stream = localStreamRef.current
    const videoTrack = stream.getVideoTracks()[0]

    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled
      setIsVideoOn(videoTrack.enabled)

      // Update WebRTC stream
      updateLocalStream(stream)

      // Notify other participants via socket
      socketService.toggleVideo({ enabled: videoTrack.enabled })
    }
  }

  const toggleAudio = async () => {
    if (!localStreamRef.current) return

    const stream = localStreamRef.current
    const audioTrack = stream.getAudioTracks()[0]

    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled
      setIsAudioOn(audioTrack.enabled)

      // Update WebRTC stream
      updateLocalStream(stream)

      // Notify other participants via socket
      socketService.toggleAudio({ enabled: audioTrack.enabled })
    }
  }

  const toggleScreenShare = async () => {
    if (!permissions?.canShareScreen) return

    try {
      if (isScreenSharing) {
        // Stop screen sharing - switch back to camera
        if (localStreamRef.current) {
          // Get new camera stream
          const cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720 },
            audio: true
          })

          // Update local video element
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = cameraStream
            await localVideoRef.current.play().catch(e => console.error('Camera video play failed:', e))
          }

          // Stop old stream
          localStreamRef.current.getTracks().forEach(track => track.stop())
          
          // Update references
          setLocalStream(cameraStream)
          localStreamRef.current = cameraStream
          
          // Update WebRTC connections
          updateLocalStream(cameraStream)
        }

        setIsScreenSharing(false)
        socketService.stopScreenShare()
      } else {
        // Start screen sharing
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: true
        })

        // Handle when user stops sharing via browser UI
        screenStream.getVideoTracks()[0].addEventListener('ended', () => {
          console.log('Screen sharing ended by user')
          toggleScreenShare()
        })

        // Update local video to show screen share
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream
          await localVideoRef.current.play().catch(e => console.error('Screen video play failed:', e))
        }

        // Stop camera stream
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop())
        }

        // Update references
        setLocalStream(screenStream)
        localStreamRef.current = screenStream

        // Update WebRTC connections
        updateLocalStream(screenStream)

        setIsScreenSharing(true)
        socketService.startScreenShare()
      }
    } catch (error) {
      console.error('Error toggling screen share:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setError(`Failed to toggle screen share: ${errorMessage}`)
    }
  }

  const sendMessage = () => {
    if (!newMessage.trim() || !permissions?.canChat) return

    socketService.sendMessage({ message: newMessage.trim() })
    setNewMessage('')
  }

  const sendReaction = (reaction: string) => {
    if (!permissions?.canReact) return
    socketService.sendReaction({ reaction })
  }

  const debugConnection = () => {
    console.log('=== CONNECTION DEBUG ===')
    console.log('Socket connected:', socketService.isConnected())
    console.log('Local stream:', localStream)
    console.log('Participants:', participants.length)
    console.log('WebRTC peers:', peers.length)
    console.log('Connection states:', connectionStates)
    console.log('User ID:', user?.id)
    
    peers.forEach((peer, index) => {
      console.log(`Peer ${index + 1}:`, {
        userId: peer.userId,
        username: peer.username,
        hasStream: !!peer.stream,
        connectionState: peer.peer.connected
      })
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
        <Link href="/webinars" className="text-blue-600 hover:text-blue-700">
          Back to Webinars
        </Link>
      </div>
    )
  }

  if (!webinar) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-700 dark:text-gray-300">Webinar not found.</p>
      </div>
    )
  }

  const isHost = participantRole === 'host'
  const otherParticipants = participants.filter(p => p.userId !== user?.id)

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 p-4 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">{webinar.title}</h1>
          <p className="text-sm text-gray-300">
            Host: {webinar.host?.firstName} {webinar.host?.lastName} • {participants.length}/{webinar.maxParticipants} participants
          </p>
        </div>
        <div className="flex items-center space-x-4">
          {/* Connection Status */}
          <div className="flex items-center space-x-2 text-xs">
            <div className={`w-2 h-2 rounded-full ${connectionStatus.socket ? 'bg-green-500' : 'bg-red-500'}`} title="Socket Connection"></div>
            <div className={`w-2 h-2 rounded-full ${connectionStatus.media ? 'bg-green-500' : 'bg-red-500'}`} title="Media Access"></div>
            <span className="text-gray-400">WebRTC: {connectionStatus.webrtc}</span>
          </div>
          
          <span className={`px-3 py-1 rounded-full text-sm ${
            webinar.status === 'live' ? 'bg-green-600' : 'bg-yellow-600'
          }`}>
            {webinar.status}
          </span>
          <Link
            href={`/webinars/${webinarId}`}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-md text-sm"
          >
            Exit Room
          </Link>
        </div>
      </header>

      <div className="flex h-[calc(100vh-80px)]">
        {/* Main Video Area */}
        <div className="flex-1 p-4">
          <div className="bg-gray-800 rounded-lg h-full relative">
            {joined ? (
              <div className="h-full flex flex-col">
                {/* Video Grid */}
                <div className="flex-1 p-4">
                  <div className={`h-full grid gap-4 ${
                    otherParticipants.length === 0 ? 'grid-cols-1' : 
                    otherParticipants.length === 1 ? 'grid-cols-2' :
                    otherParticipants.length <= 3 ? 'grid-cols-2 grid-rows-2' :
                    'grid-cols-3 grid-rows-2'
                  }`}>
                    {/* Local Video */}
                    <div className="bg-gray-700 rounded-lg overflow-hidden relative">
                      <video
                        ref={localVideoRef}
                        autoPlay
                        muted
                        playsInline
                        className="w-full h-full object-cover"
                        style={{ backgroundColor: '#374151' }}
                      />
                      {!isVideoOn && !isVideoLoading && (
                        <div className="absolute bottom-2 left-2 text-white text-sm bg-black bg-opacity-50 px-2 py-1 rounded">
                          You {isHost && '(Host)'}
                          {isScreenSharing && ' - Sharing Screen'}
                        </div>
                      )}
                    </div>

                    {/* Remote Participants */}
                    {otherParticipants.map(participant => {
                      const peerConnection = peers.find(p => p.userId === participant.userId)
                      return (
                        <RemoteVideo
                          key={participant.userId}
                          participant={participant}
                          stream={peerConnection?.stream}
                        />
                      )
                    })}

                    {/* Empty slots if needed */}
                    {otherParticipants.length === 0 && (
                      <div className="bg-gray-700 rounded-lg overflow-hidden relative flex items-center justify-center">
                        <div className="text-center text-gray-400">
                          <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          <p>Waiting for participants...</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Controls */}
                <div className="p-4 bg-gray-800 border-t border-gray-700">
                  <div className="flex justify-center space-x-4">
                    {/* Video Toggle */}
                    {needsUserInteraction ? (
                      <button
                        onClick={startVideoPlayback}
                        className="p-3 rounded-full bg-blue-600 hover:bg-blue-500"
                        title="Start Video"
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        onClick={toggleVideo}
                        className={`p-3 rounded-full ${
                          isVideoOn ? 'bg-gray-600 hover:bg-gray-500' : 'bg-red-600 hover:bg-red-500'
                        }`}
                        title={isVideoOn ? 'Turn off video' : 'Turn on video'}
                      >
                        {isVideoOn ? (
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        ) : (
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                          </svg>
                        )}
                      </button>
                    )}

                    {/* Audio Toggle */}
                    <button
                      onClick={toggleAudio}
                      className={`p-3 rounded-full ${
                        isAudioOn ? 'bg-gray-600 hover:bg-gray-500' : 'bg-red-600 hover:bg-red-500'
                      }`}
                      title={isAudioOn ? 'Mute microphone' : 'Unmute microphone'}
                    >
                      {isAudioOn ? (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                      ) : (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                        </svg>
                      )}
                    </button>

                    {/* Screen Share */}
                    {permissions?.canShareScreen && (
                      <button
                        onClick={toggleScreenShare}
                        className={`p-3 rounded-full ${
                          isScreenSharing ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-600 hover:bg-gray-500'
                        }`}
                        title={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </button>
                    )}

                    {/* Reactions */}
                    {permissions?.canReact && (
                      <div className="relative group">
                        <button
                          className="p-3 rounded-full bg-gray-600 hover:bg-gray-500"
                          title="Send reaction"
                        >
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                        <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 hidden group-hover:block">
                          <div className="bg-gray-800 rounded-lg p-2 flex space-x-2">
                            {['👍', '👎', '❤️', '😂', '😮'].map(emoji => (
                              <button
                                key={emoji}
                                onClick={() => sendReaction(emoji)}
                                className="text-2xl hover:scale-125 transition-transform"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Debug Button */}
                    <button
                      onClick={debugConnection}
                      className="p-3 rounded-full bg-purple-600 hover:bg-purple-500"
                      title="Debug connections (check console)"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </button>
                  </div>

                  {/* Error Display */}
                  {videoError && (
                    <div className="mt-4 text-red-500 text-sm text-center">
                      {videoError}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <h2 className="text-2xl font-bold mb-4">Ready to join the webinar?</h2>
                  <p className="text-gray-400 mb-6">
                    Make sure your camera and microphone are working properly.
                  </p>
                  <button
                    onClick={joinWebinar}
                    className="px-8 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-lg font-medium"
                    disabled={loading}
                  >
                    {loading ? 'Joining...' : 'Join Webinar'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col">
          {/* Participants */}
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-lg font-semibold mb-3">
              Participants ({participants.length})
            </h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {participants.length > 0 ? (
                participants.map((participant, index) => {
                  const peerConnection = peers.find(p => p.userId === participant.userId)
                  const isCurrentUser = participant.userId === user?.id
                  
                  return (
                    <div key={participant?.userId || index} className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium">
                          {participant?.firstName?.charAt(0) || '?'}
                        </span>
                      </div>
                      <div className="flex-1">
                        <span className="text-sm">
                          {participant?.firstName || 'Unknown'} {participant?.lastName || 'User'}
                          {isCurrentUser && ' (You)'}
                        </span>
                        {participant?.role === 'host' && (
                          <span className="text-xs bg-blue-600 px-2 py-1 rounded ml-2">Host</span>
                        )}
                        {!isCurrentUser && (
                          <span className={`text-xs px-2 py-1 rounded ml-2 ${
                            peerConnection ? 'bg-green-600' : 'bg-red-600'
                          }`}>
                            {peerConnection ? 'Connected' : 'Connecting...'}
                          </span>
                        )}
                      </div>
                      <div className="flex space-x-1">
                        {/* Audio indicator */}
                        <div className={`w-3 h-3 rounded-full ${
                          participant?.audioEnabled ? 'bg-green-500' : 'bg-red-500'
                        }`} title={participant?.audioEnabled ? 'Audio on' : 'Audio off'}></div>
                        {/* Video indicator */}
                        <div className={`w-3 h-3 rounded-full ${
                          participant?.videoEnabled ? 'bg-green-500' : 'bg-red-500'
                        }`} title={participant?.videoEnabled ? 'Video on' : 'Video off'}></div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="text-center">
                  <p className="text-gray-400 text-sm">No participants yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Chat */}
          {permissions?.canChat && (
            <div className="flex-1 flex flex-col">
              <div className="p-4 border-b border-gray-700">
                <h3 className="text-lg font-semibold">Chat</h3>
              </div>

              {/* Messages */}
              <div className="flex-1 p-4 overflow-y-auto">
                {chatMessages.length === 0 ? (
                  <p className="text-gray-400 text-center">No messages yet</p>
                ) : (
                  <div className="space-y-3">
                    {chatMessages.map((msg) => (
                      <div key={msg.id} className="bg-gray-700 rounded-lg p-3">
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="text-sm font-medium text-blue-400">
                            {msg.firstName} {msg.lastName}
                          </span>
                          <span className="text-xs text-gray-400">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-sm">{msg.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Message Input */}
              <div className="p-4 border-t border-gray-700">
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                    placeholder="Type a message..."
                    className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={sendMessage}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md"
                    disabled={!newMessage.trim()}
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}