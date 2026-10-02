import SharingSourcePreviewCard from '../../SharingSourcePreviewCard';
import { IpcEvents } from '../../../../../common/IpcEvents.enum';
import { useState } from 'react';
import { Text, Spinner } from '@blueprintjs/core';

interface PreviewGridListProps {
	viewSharingIds: string[];
	isEntireScreen: boolean;
	handleNextEntireScreen: () => void;
	handleNextApplicationWindow: () => void;
}

export default function PreviewGridList(props: PreviewGridListProps) {
	const [isPreparing, setIsPreparing] = useState(false);
	const [sourceError, setSourceError] = useState('');
	const {
		viewSharingIds,
		isEntireScreen,
		handleNextEntireScreen,
		handleNextApplicationWindow,
	} = props;

	return (
		<div className="share-preview-grid" data-testid="share-preview-grid">
			{viewSharingIds.map((id) => {
				return (
					<SharingSourcePreviewCard
						key={id}
						sharingSourceID={id}
						isChangeAppearanceOnHover
						onClickCard={async () => {
							if (isPreparing) return;
							setIsPreparing(true);
							setSourceError('');
							try {
								await window.electron.ipcRenderer.invoke(
									IpcEvents.SetDesktopCapturerSourceId,
									id,
								);
								if (isEntireScreen) {
									handleNextEntireScreen();
								} else {
									handleNextApplicationWindow();
								}
							} catch (error) {
								setSourceError(
									error instanceof Error ? error.message : String(error),
								);
							} finally {
								setIsPreparing(false);
							}
						}}
					/>
				);
			})}
			{isPreparing && (
				<div style={{ gridColumn: '1 / -1' }}>
					<Spinner size={24} />
				</div>
			)}
			{sourceError && (
				<div style={{ gridColumn: '1 / -1' }}>
					<Text role="alert" style={{ color: '#C23030' }}>
						{sourceError}
					</Text>
				</div>
			)}
		</div>
	);
}
