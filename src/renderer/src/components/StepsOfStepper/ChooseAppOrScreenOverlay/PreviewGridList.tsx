import { Row, Col } from 'react-flexbox-grid';
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
		<Row
			center="xs"
			around="xs"
			style={{
				height: '90%',
			}}
		>
			{viewSharingIds.map((id) => {
				return (
					<Col xs={12} md={6} key={id}>
						<SharingSourcePreviewCard
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
					</Col>
				);
			})}
			{isPreparing && (
				<Col xs={12}>
					<Spinner size={24} />
				</Col>
			)}
			{sourceError && (
				<Col xs={12}>
					<Text role="alert" style={{ color: '#C23030' }}>
						{sourceError}
					</Text>
				</Col>
			)}
		</Row>
	);
}
