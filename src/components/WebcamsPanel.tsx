"use client";

import { useState, useMemo } from "react";
import {
  Box,
  Text,
  Heading,
  Button,
  Flex,
  ScrollArea,
  Badge,
  Tooltip,
  TextField,
  Switch,
  Separator,
} from "@radix-ui/themes";
import {
  MagnifyingGlassIcon,
  Cross2Icon,
  ReloadIcon,
  CameraIcon,
} from "@radix-ui/react-icons";
import type { Webcam } from "@/lib/types";

/* ── helpers ── */

function timeAgo(ts: number): string {
  if (!ts) return "—";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/* ── component ── */

export default function WebcamsPanel({
  webcams,
  loading,
  error,
  enabled,
  onToggleEnabled,
  onRefresh,
  onSelectWebcam,
  selectedWebcamId,
}: {
  webcams: Webcam[];
  loading: boolean;
  error: string | null;
  enabled: boolean;
  onToggleEnabled: () => void;
  onRefresh: () => void;
  onSelectWebcam: (w: Webcam | null) => void;
  selectedWebcamId: string | null;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return webcams;
    const q = search.toLowerCase();
    return webcams.filter(
      (w) =>
        w.title.toLowerCase().includes(q) ||
        w.city.toLowerCase().includes(q) ||
        w.country.toLowerCase().includes(q)
    );
  }, [webcams, search]);

  return (
    <Box>
      {/* Toggle + header */}
      <Flex align="center" justify="between" px="4" py="3">
        <Flex align="center" gap="2">
          <CameraIcon />
          <Heading size="2" weight="bold" style={{ color: "white" }}>
            Live Cams
          </Heading>
          {enabled && webcams.length > 0 && (
            <Badge size="1" color="green" variant="soft">
              {webcams.length}
            </Badge>
          )}
        </Flex>
        <Flex align="center" gap="2">
          {enabled && (
            <Tooltip content="Refresh webcams">
              <Button
                size="1"
                variant="ghost"
                color="gray"
                onClick={onRefresh}
                disabled={loading}
              >
                <ReloadIcon className={loading ? "animate-spin" : ""} />
              </Button>
            </Tooltip>
          )}
          <Switch
            size="1"
            checked={enabled}
            onCheckedChange={onToggleEnabled}
            color="green"
          />
        </Flex>
      </Flex>

      {!enabled && (
        <Box px="4" pb="3">
          <Text size="1" style={{ color: "var(--gray-9)" }}>
            Toggle on to load live webcams from around the world.
          </Text>
        </Box>
      )}

      {enabled && error && (
        <Box px="4" pb="2">
          <Text size="1" color="red">
            {error}
          </Text>
        </Box>
      )}

      {enabled && loading && webcams.length === 0 && (
        <Box px="4" pb="3">
          <Text size="1" style={{ color: "var(--amber-9)" }} className="animate-pulse">
            Loading webcams…
          </Text>
        </Box>
      )}

      {enabled && webcams.length > 0 && (
        <>
          {/* Search */}
          <Box px="4" pb="2">
            <TextField.Root
              size="1"
              placeholder="Search webcams…"
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setSearch(e.target.value)
              }
            >
              <TextField.Slot>
                <MagnifyingGlassIcon height="12" width="12" />
              </TextField.Slot>
              {search && (
                <TextField.Slot>
                  <button onClick={() => setSearch("")} className="text-white/50 hover:text-white">
                    <Cross2Icon height="12" width="12" />
                  </button>
                </TextField.Slot>
              )}
            </TextField.Root>
          </Box>

          {filtered.length === 0 && (
            <Box px="4" pb="3">
              <Text size="1" style={{ color: "var(--gray-9)" }}>
                No webcams match &quot;{search}&quot;
              </Text>
            </Box>
          )}

          {/* Webcam list */}
          <ScrollArea
            scrollbars="vertical"
            style={{ maxHeight: "calc(100vh - 400px)" }}
          >
            <Box px="2" pb="2">
              {filtered.map((w) => {
                const isSelected = w.id === selectedWebcamId;
                return (
                  <button
                    key={w.id}
                    onClick={() => onSelectWebcam(isSelected ? null : w)}
                    className={`w-full text-left rounded-md px-2 py-2 mb-0.5 transition-colors ${
                      isSelected
                        ? "bg-green-900/40 ring-1 ring-green-500/40"
                        : "hover:bg-white/5"
                    }`}
                  >
                    <Flex gap="2" align="start">
                      {/* Thumbnail */}
                      {w.thumbnail && (
                        <div className="shrink-0 w-14 h-10 rounded overflow-hidden bg-black/40">
                          <img
                            src={w.thumbnail}
                            alt={w.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      )}
                      <Box style={{ minWidth: 0, flex: 1 }}>
                        <Text
                          size="1"
                          weight="medium"
                          style={{
                            color: isSelected ? "var(--green-9)" : "white",
                            display: "block",
                          }}
                          truncate
                        >
                          {w.title}
                        </Text>
                        <Flex gap="1" align="center" mt="1">
                          {w.city && (
                            <Text
                              size="1"
                              style={{ color: "var(--gray-9)" }}
                              truncate
                            >
                              {w.city}
                              {w.country ? `, ${w.country}` : ""}
                            </Text>
                          )}
                        </Flex>
                        <Flex gap="2" align="center" mt="1">
                          <Badge
                            size="1"
                            color={w.status === "active" ? "green" : "gray"}
                            variant="soft"
                          >
                            {w.status === "active" ? "Live" : "Offline"}
                          </Badge>
                          <Text size="1" style={{ color: "var(--gray-8)" }}>
                            {timeAgo(w.lastUpdated)}
                          </Text>
                        </Flex>
                      </Box>
                    </Flex>
                  </button>
                );
              })}
            </Box>
          </ScrollArea>
        </>
      )}
    </Box>
  );
}
