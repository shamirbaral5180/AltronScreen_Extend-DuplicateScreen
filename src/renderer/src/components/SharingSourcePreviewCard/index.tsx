import React, { useEffect, useRef, useState } from 'react';
import { Text, Card, Spinner } from '@blueprintjs/core';
import { IpcEvents } from '../../../../common/IpcEvents.enum';
import { useTranslation } from 'react-i18next';

class SharingSourcePreviewCardProps {
	sharingSourceID: string | undefined = '';

	onClickCard? = (): void => {
		// noop default handler
	};

	isChangeAppearanceOnHover? = false;
}

const SharingSourcePreviewCard: React.FC<SharingSourcePreviewCardProps> = (
	props,
) => {
	const { isChangeAppearanceOnHover, onClickCard, sharingSourceID } = props;
	const [sourceImage, setSourceImage] = useState('');
	const [sourceName, setSourceName] = useState('');
	const [appIconSourceImage, setAppIconSourceImage] = useState('');
	const [isHovered, setIsHovered] = useState(false);
	const { t } = useTranslation();
	const rootRef = useRef<HTMLDivElement | null>(null);
	const [isVisible, setIsVisible] = useState(false);

	useEffect(() => {
		if (!rootRef.current) return;
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						setIsVisible(true);
					}
				});
			},
			{ root: null, threshold: 0.1 },
		);
		observer.observe(rootRef.current);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!isVisible) return;
		let cancelled = false;
		const timer = setTimeout(async () => {
			if (!sharingSourceID) return;
			const sources = await window.electron.ipcRenderer.invoke(
				IpcEvents.GetDesktopCapturerServiceSourcesByIds,
				[sharingSourceID],
			);

			const data = sources?.[sharingSourceID];
			if (cancelled || !data) return;
			setSourceImage((data?.source.thumbnail as unknown as string) || '');
			if (data?.source.appIcon != null) {
				setAppIconSourceImage(
					(data?.source.appIcon as unknown as string) || '',
				);
			}
			setSourceName(data?.source.name || t('failed-to-get-source-name'));
		}, 200);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [isVisible, sharingSourceID]);

	return (
		<div ref={rootRef} className="share-preview-card-root">
			<Card
				className="preview-share-thumb-container"
				interactive={Boolean(onClickCard)}
				onClick={onClickCard ? () => onClickCard() : undefined}
				style={{
					backgroundColor:
						isHovered && isChangeAppearanceOnHover
							? '#2B95D6'
							: 'rgba(0,0,0,0.0)',
				}}
				onMouseEnter={() => setIsHovered(true)}
				onMouseOver={() => setIsHovered(true)}
				onMouseLeave={() => setIsHovered(false)}
			>
				<div className="share-preview-thumb">
					{sourceImage !== '' ? (
						<img src={sourceImage} alt="" className="share-preview-image" />
					) : (
						<Spinner size={40} />
					)}
					{appIconSourceImage !== '' && (
						<div className="share-preview-app-icon">
							<img src={appIconSourceImage} alt="" />
						</div>
					)}
				</div>
				<div
					className="share-preview-name"
					style={{
						backgroundColor:
							isHovered && isChangeAppearanceOnHover
								? 'rgba(0, 0, 0, 0.8)'
								: 'rgba(0, 0, 0, 0.45)',
					}}
				>
					<Text ellipsize>{sourceName}</Text>
				</div>
			</Card>
		</div>
	);
};

export default SharingSourcePreviewCard;
