"use client";

import { useState, useEffect } from "react";
import {
  Box,
  Flex,
  Heading,
  Text,
  Button,
  IconButton,
  Separator,
  TextField,
  ScrollArea,
  Tooltip,
  Badge,
} from "@radix-ui/themes";
import {
  Cross2Icon,
  Pencil1Icon,
  BookmarkIcon,
  BookmarkFilledIcon,
  CameraIcon,
  GlobeIcon,
  ExternalLinkIcon,
  CheckIcon,
} from "@radix-ui/react-icons";
import type { Coordinate, PlaceDetails } from "@/lib/types";

interface PointDetailPaneProps {
  coordinate: Coordinate;
  onClose: () => void;
  onFocus: (c: Coordinate) => void;
  onRename: (id: string, newLabel: string) => void;
  googleMapsApiKey?: string;
  onSaved?: () => void;
}

export default function PointDetailPane({
  coordinate,
  onClose,
  onFocus,
  onRename,
  googleMapsApiKey,
  onSaved,
}: PointDetailPaneProps) {
  const [placeDetails, setPlaceDetails] = useState<PlaceDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(coordinate.label);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch place details when coordinate changes
  useEffect(() => {
    setLoading(true);
    setPlaceDetails(null);
    setSaved(false);
    setEditing(false);
    setEditLabel(coordinate.label);

    fetch(`/api/places?lat=${coordinate.lat}&lng=${coordinate.lng}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && !data.error) setPlaceDetails(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [coordinate.lat, coordinate.lng, coordinate.label]);

  const handleRename = async () => {
    const trimmed = editLabel.trim();
    if (!trimmed) return;

    if (trimmed !== coordinate.label) {
      onRename(coordinate.id, trimmed);
      // Persist to DB
      try {
        await fetch("/api/points", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: coordinate.lat,
            lng: coordinate.lng,
            label: trimmed,
          }),
        });
      } catch {
        // Best-effort DB persist – local state already updated
      }
    }
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: coordinate.label,
          lat: coordinate.lat,
          lng: coordinate.lng,
          color: coordinate.color,
        }),
      });
      setSaved(true);
      onSaved?.();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const handleFocus = () => {
    onFocus(coordinate);
  };

  const streetViewUrl = googleMapsApiKey
    ? `https://www.google.com/maps/embed/v1/streetview?key=${googleMapsApiKey}&location=${coordinate.lat},${coordinate.lng}&heading=210&pitch=10&fov=90`
    : null;

  return (
    <aside className="w-80 shrink-0 h-full bg-[#0a0a0a] border-l border-[rgba(255,255,255,0.06)] flex flex-col animate-slide-in-right">
      {/* Header */}
      <Flex
        align="center"
        justify="between"
        px="4"
        py="3"
        className="border-b border-[rgba(255,255,255,0.06)]"
      >
        <Flex align="center" gap="2" style={{ minWidth: 0 }}>
          <span
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: coordinate.color ?? "#ff6600" }}
          />
          <Heading size="2" weight="bold" style={{ color: "white" }} truncate>
            {coordinate.label}
          </Heading>
        </Flex>
        <Tooltip content="Close panel">
          <IconButton
            variant="ghost"
            color="gray"
            size="1"
            onClick={onClose}
          >
            <Cross2Icon />
          </IconButton>
        </Tooltip>
      </Flex>

      {/* Scrollable content */}
      <ScrollArea scrollbars="vertical" className="flex-1">
        <Flex direction="column" gap="4" p="4">
          {/* Coordinates */}
          <Box>
            <Text size="1" color="gray" weight="medium" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Coordinates
            </Text>
            <Text size="2" mt="1" as="p" style={{ color: "var(--gray-11)", fontFamily: "var(--font-mono)" }}>
              {coordinate.lat.toFixed(6)}, {coordinate.lng.toFixed(6)}
            </Text>
          </Box>

          <Separator size="4" />

          {/* Place Details */}
          <Box>
            <Text size="1" color="gray" weight="medium" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Place Info
            </Text>

            {loading ? (
              <Flex align="center" gap="2" mt="2">
                <div className="w-3 h-3 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
                <Text size="1" color="gray">Loading place details…</Text>
              </Flex>
            ) : placeDetails ? (
              <Flex direction="column" gap="2" mt="2">
                {/* Photo */}
                {placeDetails.photoUrl && (
                  <Box className="rounded-lg overflow-hidden" style={{ aspectRatio: "16/10" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={placeDetails.photoUrl}
                      alt={placeDetails.name ?? coordinate.label}
                      className="w-full h-full object-cover"
                    />
                  </Box>
                )}

                {/* Name */}
                {placeDetails.name && (
                  <Text size="2" weight="medium" style={{ color: "white" }}>
                    {placeDetails.name}
                  </Text>
                )}

                {/* Address */}
                {placeDetails.address && (
                  <Flex gap="2" align="start">
                    <Text size="1" color="gray" className="shrink-0 mt-0.5">📍</Text>
                    <Text size="1" color="gray">{placeDetails.address}</Text>
                  </Flex>
                )}

                {/* Phone */}
                {placeDetails.phone && (
                  <Flex gap="2" align="center">
                    <Text size="1" color="gray">📞</Text>
                    <Text size="1" style={{ color: "var(--accent-11)" }}>
                      {placeDetails.phone}
                    </Text>
                  </Flex>
                )}

                {/* Website */}
                {placeDetails.website && (
                  <Flex gap="2" align="center">
                    <Text size="1" color="gray">🌐</Text>
                    <a
                      href={placeDetails.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[var(--accent-11)] hover:underline truncate"
                    >
                      {new URL(placeDetails.website).hostname}
                      <ExternalLinkIcon
                        className="inline ml-1"
                        width={10}
                        height={10}
                      />
                    </a>
                  </Flex>
                )}

                {/* Hours */}
                {placeDetails.hours && placeDetails.hours.length > 0 && (
                  <Box>
                    <Flex gap="2" align="center" mb="1">
                      <Text size="1" color="gray">⏰</Text>
                      {placeDetails.isOpen != null && (
                        <Badge
                          variant="soft"
                          size="1"
                          color={placeDetails.isOpen ? "green" : "red"}
                        >
                          {placeDetails.isOpen ? "Open" : "Closed"}
                        </Badge>
                      )}
                    </Flex>
                    <Flex direction="column" gap="0" ml="5">
                      {placeDetails.hours.map((h, i) => (
                        <Text key={i} size="1" color="gray">
                          {h}
                        </Text>
                      ))}
                    </Flex>
                  </Box>
                )}

                {/* Google Maps link */}
                {placeDetails.mapsUrl && (
                  <a
                    href={placeDetails.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--accent-11)] hover:underline flex items-center gap-1 mt-1"
                  >
                    <GlobeIcon width={12} height={12} />
                    View on Google Maps
                    <ExternalLinkIcon width={10} height={10} />
                  </a>
                )}
              </Flex>
            ) : (
              <Text size="1" color="gray" mt="2" as="p">
                No place details available for this location.
              </Text>
            )}
          </Box>

          <Separator size="4" />

          {/* Street View Embed */}
          <Box>
            <Flex align="center" gap="1">
              <CameraIcon width={12} height={12} style={{ color: "var(--gray-11)" }} />
              <Text size="1" color="gray" weight="medium" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Street View
              </Text>
            </Flex>

            {streetViewUrl ? (
              <Box mt="2" className="rounded-lg overflow-hidden" style={{ aspectRatio: "16/10" }}>
                <iframe
                  src={streetViewUrl}
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Google Street View"
                />
              </Box>
            ) : (
              <Text size="1" color="gray" mt="2" as="p">
                Street View unavailable (API key not configured).
              </Text>
            )}
          </Box>

          <Separator size="4" />

          {/* Edit Label */}
          <Box>
            <Flex align="center" gap="1" mb="2">
              <Pencil1Icon width={12} height={12} style={{ color: "var(--gray-11)" }} />
              <Text size="1" color="gray" weight="medium" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Label
              </Text>
            </Flex>

            {editing ? (
              <Flex gap="2">
                <TextField.Root
                  size="1"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") {
                      setEditing(false);
                      setEditLabel(coordinate.label);
                    }
                  }}
                  style={{ flex: 1 }}
                  autoFocus
                />
                <Tooltip content="Save label">
                  <IconButton
                    variant="soft"
                    color="green"
                    size="1"
                    onClick={handleRename}
                  >
                    <CheckIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip content="Cancel">
                  <IconButton
                    variant="soft"
                    color="gray"
                    size="1"
                    onClick={() => {
                      setEditing(false);
                      setEditLabel(coordinate.label);
                    }}
                  >
                    <Cross2Icon />
                  </IconButton>
                </Tooltip>
              </Flex>
            ) : (
              <Flex align="center" justify="between">
                <Text size="2" style={{ color: "var(--gray-11)" }}>
                  {coordinate.label}
                </Text>
                <Tooltip content="Edit label">
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="1"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil1Icon />
                  </IconButton>
                </Tooltip>
              </Flex>
            )}
          </Box>

          <Separator size="4" />

          {/* Action Buttons */}
          <Flex direction="column" gap="2">
            <Button
              variant="soft"
              color="amber"
              size="2"
              onClick={handleFocus}
              style={{ cursor: "pointer" }}
            >
              <GlobeIcon />
              Focus on Map
            </Button>

            <Button
              variant="soft"
              color={saved ? "green" : "gray"}
              size="2"
              onClick={handleSave}
              disabled={saving || saved}
              style={{ cursor: saved ? "default" : "pointer" }}
            >
              {saved ? <BookmarkFilledIcon /> : <BookmarkIcon />}
              {saved ? "Saved to Presets" : saving ? "Saving…" : "Save to Quick Presets"}
            </Button>
          </Flex>
        </Flex>
      </ScrollArea>
    </aside>
  );
}
