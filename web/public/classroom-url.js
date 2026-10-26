// Classroom names are the directory's identifiers. Only restore accessible rooms.
export function classroomFromURL(href,computers){
  const room=new URL(href).searchParams.get('classroom');
  return room!==null&&computers.some(computer=>computer.room===room)?room:null;
}
export function classroomURL(href,room){
  const url=new URL(href);
  if(room===null)url.searchParams.delete('classroom');
  else url.searchParams.set('classroom',room);
  return url;
}
