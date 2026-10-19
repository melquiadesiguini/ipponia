import Style from './Footer.module.css'
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLaptopCode } from "@fortawesome/free-solid-svg-icons";
import { NOMBRE_EMPRESA } from '../../lib/contacto'

function Footer () {
  return (
    <footer className={Style.footer}>
            <div className={Style.container}>
                <p>&copy; {new Date().getFullYear()} {NOMBRE_EMPRESA}. Todos los derechos reservados.</p>
                <p>Hecho con <FontAwesomeIcon icon={faLaptopCode} /> y pasión marcial.</p>
            </div>
        </footer>
  )
}

export default Footer
