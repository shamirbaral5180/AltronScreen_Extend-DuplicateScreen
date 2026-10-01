export default (sdp: string, mediaType: string, bitrate: number) => {
	if (typeof sdp !== 'string' || sdp.length === 0) {
		return sdp;
	}

	const sdpLines = sdp.split('\n');
	const mediaLine = `m=${mediaType}`;
	// AS uses kilobits/second; sender parameters use bits/second.
	const bitrateLine = `b=AS:${Math.ceil(bitrate / 1000)}`;
	const mediaLineIndex = sdpLines.findIndex((line) =>
		line.startsWith(mediaLine),
	);

	// If we find a line matching "m={mediaType}"
	if (mediaLineIndex !== -1 && mediaLineIndex < sdpLines.length) {
		// Skip the media line and any i=* / c=* lines (bandwidth limiters must
		// come after them).
		let bitrateLineIndex = mediaLineIndex + 1;
		while (
			bitrateLineIndex < sdpLines.length &&
			(sdpLines[bitrateLineIndex].startsWith('i=') ||
				sdpLines[bitrateLineIndex].startsWith('c='))
		) {
			bitrateLineIndex += 1;
		}

		if (bitrateLineIndex >= sdpLines.length) {
			return sdpLines.join('\n');
		}

		if (sdpLines[bitrateLineIndex].startsWith('b=')) {
			// If the next line is a b=* line, replace it with our new bandwidth
			sdpLines[bitrateLineIndex] = bitrateLine;
		} else {
			// Otherwise insert a new bitrate line.
			sdpLines.splice(bitrateLineIndex, 0, bitrateLine);
		}
	}

	// Then return the updated sdp content as a string
	return sdpLines.join('\n');
};
