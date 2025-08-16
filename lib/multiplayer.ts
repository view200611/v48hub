"use server"

import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

// Helper function to create an empty board
function createEmptyBoard(): string[][] {
  return Array.from({ length: 3 }, () => Array(3).fill(null))
}

// Generate a random room code (moved to utils since it's not async)
function generateRoomCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Create a new room
export async function createRoom(prevState: any, formData: FormData) {
  try {
    const supabase = createClient()

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    console.log("[v0] Create room - User check:", { user: user?.id, error: userError })

    if (!user || userError) {
      console.log("[v0] Create room - No user, redirecting to login")
      redirect("/auth/login")
    }

    // Generate unique room code
    let roomCode = generateRoomCode()
    let attempts = 0

    while (attempts < 10) {
      const { data: existingRoom } = await supabase.from("rooms").select("id").eq("room_code", roomCode).single()

      if (!existingRoom) break

      roomCode = generateRoomCode()
      attempts++
    }

    if (attempts >= 10) {
      return { error: "Failed to generate unique room code. Please try again." }
    }

    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 2)

    // Create room
    const { data: room, error } = await supabase
      .from("rooms")
      .insert({
        room_code: roomCode,
        creator_id: user.id,
        player1_id: user.id,
        status: "waiting",
        current_player: "X",
        board_state: JSON.stringify(createEmptyBoard()),
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error("[v0] Room creation error:", error)
      return { error: "Failed to create room: " + error.message }
    }

    console.log("[v0] Room created successfully:", roomCode)
    return { success: true, roomCode: roomCode }
  } catch (error) {
    console.error("[v0] Error creating room:", error)
    return { error: "An unexpected error occurred" }
  }
}

// Join an existing room
export async function joinRoom(prevState: any, formData: FormData) {
  try {
    const roomCode = formData.get("roomCode")?.toString().toUpperCase()

    if (!roomCode) {
      console.log("[v0] Join room - No room code provided")
      return { error: "Room code is required" }
    }

    const supabase = createClient()

    // Get current user with better error handling
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    console.log("[v0] Join room - User check:", { user: user?.id, error: userError })

    if (!user || userError) {
      console.log("[v0] Join room - No user, redirecting to login")
      redirect("/auth/login")
    }

    console.log("[v0] Attempting to join room:", roomCode, "User ID:", user.id)

    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("*")
      .eq("room_code", roomCode)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle()

    if (roomError) {
      console.log("[v0] Room query error:", roomError)
      return { error: "Database error: " + roomError.message }
    }

    if (!room) {
      console.log("[v0] Room not found")
      return { error: "Room not found or has expired" }
    }

    console.log("[v0] Found room:", room)

    // Check if room is available
    if (room.status !== "waiting") {
      console.log("[v0] Room status is not waiting:", room.status)
      return { error: "Room is not available" }
    }

    // Check if user is already in room
    if (room.creator_id === user.id) {
      console.log("[v0] User is room creator, redirecting")
      return { success: true, roomCode: roomCode }
    }

    if (room.player2_id) {
      console.log("[v0] Room already has player2:", room.player2_id)
      return { error: "Room is full" }
    }

    console.log("[v0] Updating room to add player2")

    const { data: updatedRoom, error: updateError } = await supabase
      .from("rooms")
      .update({
        player2_id: user.id,
        status: "playing",
      })
      .eq("id", room.id)
      .eq("status", "waiting") // Ensure room is still waiting
      .select()
      .maybeSingle()

    if (updateError) {
      console.error("[v0] Join room update error:", updateError)
      return { error: "Failed to join room: " + updateError.message }
    }

    if (!updatedRoom) {
      console.log("[v0] Room update returned no data - room may have been taken")
      return { error: "Room is no longer available" }
    }

    console.log("[v0] Successfully joined room:", updatedRoom)
    return { success: true, roomCode: roomCode }
  } catch (error) {
    console.error("[v0] Error joining room:", error)

    if (error instanceof Error && error.message.includes("NEXT_REDIRECT")) {
      throw error // Re-throw redirect errors
    }

    return { error: "An unexpected error occurred: " + (error as Error).message }
  }
}

export async function updateOnlineStatus(isOnline: boolean) {
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return

    await supabase
      .from("users")
      .update({
        last_seen: new Date().toISOString(),
        is_online: isOnline,
      })
      .eq("id", user.id)
  } catch (error) {
    console.error("[v0] Error updating online status:", error)
  }
}
