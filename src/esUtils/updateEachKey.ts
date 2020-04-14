import { IndexedObject } from '../Interfaces';

// A generic updater function for arrays or objects.
export default function updateEachKey<V>(
  arrayOrObject: IndexedObject<V>,
  // The callback can return nothing or undefined to leave the key untouched, null to remove
  // the key from the array or object, or a non-null V to replace the value.
  updater: (value: V, key: string) => void | null | V,
) {
  let deletedCount = 0;

  Object.keys(arrayOrObject).forEach((key) => {
    const result = updater(arrayOrObject[key], key);

    if (typeof result === 'undefined') {
      return;
    }

    if (result === null) {
      delete arrayOrObject[key];
      deletedCount++;
      return;
    }

    arrayOrObject[key] = result;
  });

  if (deletedCount > 0 && Array.isArray(arrayOrObject)) {
    // Remove any holes from the array due to deleted elements.
    arrayOrObject.splice(0).forEach((elem) => {
      arrayOrObject.push(elem);
    });
  }
}
