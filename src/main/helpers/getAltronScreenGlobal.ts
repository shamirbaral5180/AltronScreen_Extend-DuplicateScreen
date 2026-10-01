import { AltronScreenGlobal } from './initGlobals';

export const getAltronScreenGlobal = (): AltronScreenGlobal => {
	return global as unknown as AltronScreenGlobal;
};
