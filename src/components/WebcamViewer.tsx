"use client";

import { Box, Flex, Heading, Text, IconButton } from "@radix-ui/themes";
import { Cross2Icon } from "@radix-ui/react-icons";
import type { Webcam } from "@/lib/types";

/**
 * Full-screen overlay that embeds a webcam player via iframe.
 * Windy's embed URLs use HTTPS and allow iframe embedding.
 */
export default function WebcamViewer({
  webcam,
  onClose,
}: {
  webcam: Webcam;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-[10001] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative w-[90%] max-w-4xl rounded-xl overflow-hidden border border-white/10 bg-[#0a0a0a] shadow-2xl flex flex-col">
        {/* Header */}
        <Flex
          align="center"
          justify="between"
          px="4"
          py="3"
          className="border-b border-white/10"
        >
          <Box>
            <Heading size="3" weight="bold" style={{ color: "white" }}>
              {webcam.title}
            </Heading>
            {webcam.city && (
              <Text size="1" style={{ color: "var(--gray-9)" }}>
                {webcam.city}
                {webcam.country ? `, ${webcam.country}` : ""}
              </Text>
            )}
          </Box>
          <IconButton
            size="2"
            variant="ghost"
            color="gray"
            onClick={onClose}
            aria-label="Close webcam viewer"
          >
            <Cross2Icon />
          </IconButton>
        </Flex>

        {/* Player iframe */}
        <div className="relative w-full" style={{ paddingTop: "56.25%" /* 16:9 */ }}>
          {webcam.playerUrl ? (
            <iframe
              src={webcam.playerUrl}
              className="absolute inset-0 w-full h-full"
              allow="autoplay; fullscreen"
              allowFullScreen
              style={{ border: "none" }}
              title={`Live cam: ${webcam.title}`}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              {webcam.thumbnail ? (
                <img
                  src={webcam.thumbnail}
                  alt={webcam.title}
                  className="w-full h-full object-contain"
                />
              ) : (
                <Text size="2" style={{ color: "var(--gray-9)" }}>
                  No live stream available for this webcam.
                </Text>
              )}
            </div>
          )}
        </div>

        {/* Footer info */}
        <Flex
          align="center"
          gap="3"
          px="4"
          py="2"
          className="border-t border-white/10"
        >
          <Text size="1" style={{ color: "var(--gray-8)" }}>
            {webcam.lat.toFixed(4)}°, {webcam.lng.toFixed(4)}°
          </Text>
          <Text size="1" style={{ color: webcam.status === "active" ? "var(--green-9)" : "var(--gray-8)" }}>
            {webcam.status === "active" ? "● Live" : "● Offline"}
          </Text>
          <Text size="1" style={{ color: "var(--gray-8)" }}>
            Powered by Windy Webcams
          </Text>
        </Flex>
      </div>
    </div>
  );
}
